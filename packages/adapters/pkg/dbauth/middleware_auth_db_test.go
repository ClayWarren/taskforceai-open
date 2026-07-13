package dbauth

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithAuthDB_AdminPromotionDBErrorStillAuthenticates(t *testing.T) {
	email := "promote-db-error@example.com"
	t.Setenv("ADMIN_EMAILS", email)

	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:      31,
		Email:   email,
		Plan:    "pro",
		IsAdmin: false,
	}
	fakeDB.updateUserAdminErr = errors.New("update failed")

	called := false
	middleware := WithAuthDB(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
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

func TestWithAuthDB_ClaimOrganizationScopeRequiresMembership(t *testing.T) {
	email := "claim-org-membership@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"org_id": float64(42),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    42,
		Email: email,
		Plan:  "pro",
	}
	fakeDB.membershipByKey[membershipLookupKey(42, 42)] = Membership{
		ID:             1,
		OrganizationID: 42,
		UserID:         42,
		Role:           OrganizationRoleMEMBER,
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.IsType(t, int(0), r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, 42, r.Context().Value(handler.OrgIDContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithAuthDB_ClaimOrganizationScopeWithoutMembershipReturnsForbidden(t *testing.T) {
	email := "claim-org-revoked@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"org_id": float64(42),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    42,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestWithAuthDB_RejectsMFAPendingToken(t *testing.T) {
	email := "mfa-pending-db@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":       email,
		"sub":         "42",
		"mfa_pending": true,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    42,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestWithAuthDB_DisabledUserReturnsForbidden(t *testing.T) {
	email := "disabled@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:       7,
		Email:    email,
		Disabled: true,
		Plan:     "pro",
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.False(t, called)
}

func TestWithAuthDB_MissingEmailReturnsUnauthorized(t *testing.T) {
	token := mustSignToken(t, jwt.MapClaims{
		"sub": "missing-email-user",
	})

	called := false
	middleware := WithAuthDB(New(newMiddlewareFakeDB()), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestWithAuthDB_NegativeOrgIDReturnsUnauthorized(t *testing.T) {
	email := "negative-org@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":  email,
		"org_id": float64(-1),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    88,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestWithAuthDB_NegativeUserIDReturnsUnauthorized(t *testing.T) {
	email := "negative-id@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    -5,
		Email: email,
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestWithAuthDB_NilQueriesReturnsInternalServerError(t *testing.T) {
	token := mustSignToken(t, jwt.MapClaims{
		"email": "nil-queries@example.com",
	})

	called := false
	middleware := WithAuthDB(nil, func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.False(t, called)
}

func TestWithAuthDB_OrganizationScopeFailures(t *testing.T) {
	email := "scope@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})
	baseUser := User{
		ID:    44,
		Email: email,
		Plan:  "super",
	}

	tests := []struct {
		name    string
		header  string
		setupDB func(*middlewareFakeDB)
	}{
		{
			name:   "invalid org id header",
			header: "not-a-number",
		},
		{
			name:   "org id over max int32",
			header: strconv.FormatInt(int64(math.MaxInt32)+1, 10),
		},
		{
			name:   "membership missing",
			header: "123",
		},
		{
			name:   "membership lookup error",
			header: "124",
			setupDB: func(fakeDB *middlewareFakeDB) {
				fakeDB.membershipErrors[membershipLookupKey(124, baseUser.ID)] = errors.New("membership lookup failed")
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fakeDB := newMiddlewareFakeDB()
			fakeDB.usersByEmail[email] = baseUser
			if tc.setupDB != nil {
				tc.setupDB(fakeDB)
			}

			called := false
			middleware := WithAuthDB(New(fakeDB), func(http.ResponseWriter, *http.Request) {
				called = true
			})

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-Org-ID", tc.header)
			rec := httptest.NewRecorder()

			middleware(rec, req)

			assert.Equal(t, http.StatusForbidden, rec.Code)
			assert.False(t, called)
		})
	}
}

func TestWithAuthDB_RevokedTokenReturnsUnauthorized(t *testing.T) {
	email := "revoked@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    17,
		Email: email,
		Plan:  "pro",
	}

	originalRevocationCheck := handler.IsTokenRevoked
	handler.IsTokenRevoked = func(_ context.Context, rawToken string) bool {
		return rawToken == token
	}
	defer func() {
		handler.IsTokenRevoked = originalRevocationCheck
	}()

	called := false
	middleware := WithAuthDB(New(fakeDB), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestWithAuthDB_SetsContextValuesOnSuccess(t *testing.T) {
	email := "auth-success@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email":         email,
		"org_id":        float64(7),
		"workos_org_id": "workos-org-123",
		"act_as":        "admin-user-1",
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:               12,
		Email:            email,
		Plan:             "super",
		IsAdmin:          true,
		QuickModeEnabled: true,
	}
	fakeDB.membershipByKey[membershipLookupKey(88, 12)] = Membership{
		ID:             1,
		OrganizationID: 88,
		UserID:         12,
		Role:           OrganizationRoleMEMBER,
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true

		user := handler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 12, user.ID)
		assert.Equal(t, email, user.Email)
		assert.True(t, user.IsAdmin)
		assert.True(t, user.QuickModeEnabled)
		if assert.NotNil(t, user.Plan) {
			assert.Equal(t, "super", *user.Plan)
		}
		if assert.NotNil(t, user.OrgID) {
			assert.Equal(t, 7, *user.OrgID)
		}
		if assert.NotNil(t, user.WorkosOrgID) {
			assert.Equal(t, "workos-org-123", *user.WorkosOrgID)
		}
		if assert.NotNil(t, user.ImpersonatorID) {
			assert.Equal(t, "admin-user-1", *user.ImpersonatorID)
		}

		assert.IsType(t, int(0), r.Context().Value(handler.UserIDContextKey))
		assert.Equal(t, 12, r.Context().Value(handler.UserIDContextKey))
		assert.IsType(t, int(0), r.Context().Value(handler.OrgIDContextKey))
		assert.Equal(t, 88, r.Context().Value(handler.OrgIDContextKey))

		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Org-ID", "88")
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithAuthDB_SetsTokenIssuedAtContext(t *testing.T) {
	email := "issued-at@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
		"iat":   float64(1700000000),
	})

	fakeDB := newMiddlewareFakeDB()
	fakeDB.usersByEmail[email] = User{
		ID:    91,
		Email: email,
		Plan:  "pro",
	}

	called := false
	middleware := WithAuthDB(New(fakeDB), func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Equal(t, int64(1700000000), r.Context().Value(handler.TokenIssuedAtContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithAuthDB_UnauthorizedWhenTokenMissingOrInvalid(t *testing.T) {
	tests := []struct {
		name       string
		authHeader string
	}{
		{
			name: "missing bearer token",
		},
		{
			name:       "invalid bearer token",
			authHeader: "Bearer invalid-token",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			middleware := WithAuthDB(New(newMiddlewareFakeDB()), func(http.ResponseWriter, *http.Request) {
				called = true
			})

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			rec := httptest.NewRecorder()

			middleware(rec, req)

			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.False(t, called)
		})
	}
}

func TestWithAuthDB_UserNotFoundReturnsUnauthorized(t *testing.T) {
	email := "missing-user@example.com"
	token := mustSignToken(t, jwt.MapClaims{
		"email": email,
	})

	called := false
	middleware := WithAuthDB(New(newMiddlewareFakeDB()), func(http.ResponseWriter, *http.Request) {
		called = true
	})

	req, rec := newBearerRequest(token)

	middleware(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}
