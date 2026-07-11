package dbauth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithFlexibleAuth_APIKeyBackendUnavailableReturnsError(t *testing.T) {
	rawKey := "flex-backend-error-key"
	keyHash := hashAPIKey(rawKey)

	fakeDB := newMiddlewareFakeDB()
	fakeDB.apiKeyErrors[keyHash] = errors.New("database unavailable")

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("x-api-key", rawKey)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.False(t, called)
}

func TestWithFlexibleAuth_APIKeyNegativeUserIDProceedsUnauthenticated(t *testing.T) {
	rawKey := "taskforce-api-key-negative"
	keyHash := hashAPIKey(rawKey)

	fakeDB := newMiddlewareFakeDB()
	fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, -123, false, DeveloperApiTierPRO)

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, handler.GetAuthenticatedUser(r))
		assert.Nil(t, r.Context().Value(handler.UserIDContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("x-api-key", rawKey)
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_APIKeyPathSetsContext(t *testing.T) {
	rawKey := "taskforce-api-key"
	keyHash := hashAPIKey(rawKey)

	fakeDB := newMiddlewareFakeDB()
	fakeDB.apiKeysByHash[keyHash] = apiKeyRecord(keyHash, 901, false, DeveloperApiTierENTERPRISE)

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true

		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 901, user.ID)
		if assert.NotNil(t, user.Plan) {
			assert.Equal(t, string(DeveloperApiTierENTERPRISE), *user.Plan)
		}

		assert.IsType(t, int(0), r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, 901, r.Context().Value(handler.UserIDContextKey))
		assert.Nil(t, r.Context().Value(handler.EmailContextKey))

		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("x-api-key", rawKey)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_APIKeyRateLimitExceededReturnsTooManyRequests(t *testing.T) {
	rawKey := "rate-limited-api-key"
	keyHash := hashAPIKey(rawKey)

	fakeDB := newMiddlewareFakeDB()
	record := apiKeyRecord(keyHash, 222, false, DeveloperApiTierPRO)
	fakeDB.apiKeysByHash[keyHash] = record
	fakeDB.apiUsageByKey[record.ID] = record.RateLimit

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("x-api-key", rawKey)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.False(t, called)
	assert.Empty(t, fakeDB.apiUsageCalls)
	assert.Empty(t, fakeDB.incrementQuotaCalls)
}

func TestWithFlexibleAuth_AdminEmailsPromotesUserAndPersists(t *testing.T) {
	email := "flex-promote@example.com"
	t.Setenv("ADMIN_EMAILS", "flex-promote@example.com")

	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
		"sub":   "66",
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:      66,
		Email:   email,
		Plan:    "free",
		IsAdmin: false,
	}

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.True(t, user.IsAdmin)
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	require.Len(t, fakeDB.updateUserAdminCalls, 1)
	assert.Equal(t, UpdateUserAdminByEmailParams{
		Email:   email,
		IsAdmin: true,
	}, fakeDB.updateUserAdminCalls[0])
}

func TestWithFlexibleAuth_AdminPromotionDBErrorStillAuthenticates(t *testing.T) {
	email := "flex-promote-error@example.com"
	t.Setenv("ADMIN_EMAILS", email)

	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
		"sub":   "78",
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:      78,
		Email:   email,
		Plan:    "pro",
		IsAdmin: false,
	}
	fakeDB.updateUserAdminErr = errors.New("update failed")

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.True(t, user.IsAdmin)
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_InvalidAPIKeyWithoutTokenProceedsUnauthenticated(t *testing.T) {
	called := false
	middleware := WithFlexibleAuth(New(newMiddlewareFakeDB()), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, handler.GetAuthenticatedUser(r))
		assert.Nil(t, r.Context().Value(handler.UserIDContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("x-api-key", "invalid-key")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_NilQueriesProceedsUnauthenticated(t *testing.T) {
	token := mustSignToken(t, jwt.MapClaims{
		"email": "nil-queries-flex@example.com",
	})

	called := false
	middleware := WithFlexibleAuth(nil, func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, handler.GetAuthenticatedUser(r))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_SetsOrgAndIssuedAtContext(t *testing.T) {
	email := "flex-context@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"sub":    "79",
		"org_id": float64(15),
		"iat":    float64(1700000002),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    79,
		Email: email,
		Plan:  "pro",
	}
	fakeDB.membershipByKey[membershipLookupKey(15, 79)] = Membership{
		OrganizationID: 15,
		UserID:         79,
		Role:           OrganizationRoleMEMBER,
	}

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Equal(t, 15, r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, int64(1700000002), r.Context().Value(handler.TokenIssuedAtContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_TokenPathSetsContextValues(t *testing.T) {
	email := "flex-token@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"sub":    "55",
		"org_id": float64(5),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:               55,
		Email:            email,
		Plan:             "pro",
		IsAdmin:          false,
		QuickModeEnabled: true,
	}
	fakeDB.membershipByKey[membershipLookupKey(90, 55)] = Membership{
		ID:             2,
		OrganizationID: 90,
		UserID:         55,
		Role:           OrganizationRoleOWNER,
	}

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true

		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 55, user.ID)
		assert.Equal(t, email, user.Email)
		assert.True(t, user.QuickModeEnabled)
		if assert.NotNil(t, user.OrgID) {
			assert.Equal(t, 5, *user.OrgID)
		}

		assert.IsType(t, int(0), r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, 55, r.Context().Value(handler.UserIDContextKey))
		assert.IsType(t, int(0), r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, 90, r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, email, r.Context().Value(handler.EmailContextKey))

		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Org-ID", "90")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithFlexibleAuth_IgnoresMFAPendingToken(t *testing.T) {
	email := "flex-mfa-pending@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":       email,
		"sub":         "55",
		"mfa_pending": true,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    55,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithFlexibleAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, handler.GetAuthenticatedUser(r))
		assert.Nil(t, r.Context().Value(handler.UserIDContextKey))
		assert.Nil(t, r.Context().Value(handler.EmailContextKey))
		assert.Nil(t, r.Context().Value(handler.AuthMethodContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithLazyOptionalDBAuth_QueryErrorFallsBackToTokenAuth(t *testing.T) {
	token := mustSignToken(t, jwt.MapClaims{
		"email": "fallback@example.com",
		"sub":   "81",
	})

	called := false
	middleware := WithLazyOptionalDBAuth(func(context.Context) (*Queries, error) {
		return nil, errors.New("db unavailable")
	}, func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 81, user.ID)
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithLazyOptionalDBAuth_NilGetterFallsBackToTokenAuth(t *testing.T) {
	token := mustSignToken(t, jwt.MapClaims{
		"email": "fallback-nil@example.com",
		"sub":   "83",
	})

	called := false
	middleware := WithLazyOptionalDBAuth(nil, func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 83, user.ID)
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithLazyOptionalDBAuth_UsesDBAuthWhenQueriesResolve(t *testing.T) {
	email := "db-auth@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
		"sub":   "81",
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    82,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithLazyOptionalDBAuth(func(context.Context) (*Queries, error) {
		return New(fakeDB), nil
	}, func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 82, user.ID)
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalDBAuth_NilQueriesProceeds(t *testing.T) {
	called := false
	middleware := WithOptionalDBAuth(nil, func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalDBAuth_SetsOrgAndIssuedAtContext(t *testing.T) {
	email := "optional-context@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"sub":    "66",
		"org_id": float64(12),
		"iat":    float64(1700000001),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    66,
		Email: email,
		Plan:  "pro",
	}
	fakeDB.membershipByKey[membershipLookupKey(12, 66)] = Membership{
		OrganizationID: 12,
		UserID:         66,
		Role:           OrganizationRoleMEMBER,
	}

	called := false
	middleware := WithOptionalDBAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Equal(t, 12, r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, int64(1700000001), r.Context().Value(handler.TokenIssuedAtContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalDBAuth_TokenPathSetsContextValues(t *testing.T) {
	email := "optional-db-auth@example.com"
	fullName := "Optional DB Auth"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"sub":    "155",
		"org_id": float64(5),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:               155,
		Email:            email,
		FullName:         &fullName,
		Plan:             "pro",
		IsAdmin:          true,
		QuickModeEnabled: true,
	}
	fakeDB.membershipByKey[membershipLookupKey(90, 155)] = Membership{
		ID:             2,
		OrganizationID: 90,
		UserID:         155,
		Role:           OrganizationRoleOWNER,
	}

	called := false
	middleware := WithOptionalDBAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true

		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 155, user.ID)
		assert.Equal(t, email, user.Email)
		assert.True(t, user.IsAdmin)
		assert.True(t, user.QuickModeEnabled)
		if assert.NotNil(t, user.FullName) {
			assert.Equal(t, fullName, *user.FullName)
		}
		if assert.NotNil(t, user.Plan) {
			assert.Equal(t, "pro", *user.Plan)
		}
		if assert.NotNil(t, user.OrgID) {
			assert.Equal(t, 5, *user.OrgID)
		}

		assert.IsType(t, int(0), r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, 155, r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, email, r.Context().Value(handler.EmailContextKey))
		assert.IsType(t, int(0), r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, 90, r.Context().Value(handler.OrgIDContextKey))

		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Org-ID", "90")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalDBAuth_IgnoresMFAPendingToken(t *testing.T) {
	email := "optional-mfa-pending@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":       email,
		"sub":         "155",
		"mfa_pending": true,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    155,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithOptionalDBAuth(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, handler.GetAuthenticatedUser(r))
		assert.Nil(t, r.Context().Value(handler.UserIDContextKey))
		assert.Nil(t, r.Context().Value(handler.EmailContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOrganizationScopeDirect(t *testing.T) {
	ctx := context.Background()
	q := New(newMiddlewareFakeDB())

	gotCtx, err := withOrganizationScope(ctx, q, 1, "")
	require.NoError(t, err)
	assert.Equal(t, gotCtx, ctx)

	_, err = withOrganizationScope(ctx, nil, 1, "1")
	require.ErrorContains(t, err, "queries are not configured")

	_, err = withOrganizationScope(ctx, q, 1, "abc")
	require.ErrorContains(t, err, "invalid organization id")

	_, err = withOrganizationScope(ctx, q, 1, "0")
	require.ErrorContains(t, err, "invalid organization id")

	fake := newMiddlewareFakeDB()
	fake.membershipByKey["7:1"] = Membership{OrganizationID: 7, UserID: 1}
	scopedCtx, err := withOrganizationScope(ctx, New(fake), 1, "7")
	require.NoError(t, err)
	assert.Equal(t, 7, scopedCtx.Value(handler.OrgIDContextKey))
}
