package mobile

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	provider_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	servicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestResolveAppleAudiences(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL", "")
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	t.Setenv("APPLE_BUNDLE_ID", "com.taskforceai.mobile")
	t.Setenv("APPLE_ALLOWED_AUDIENCES", " host.exp.Exponent ,com.taskforceai.mobile, com.taskforceai.web ")

	got := resolveAppleAudiences()
	assert.Len(t, got, 3)
	assert.True(t, slices.Contains(got, "com.taskforceai.mobile"))
	assert.True(t, slices.Contains(got, "host.exp.Exponent"))
	assert.True(t, slices.Contains(got, "com.taskforceai.web"))
}

func TestCachedAppleClient_ReusesVerifierForAudience(t *testing.T) {
	audience := "com.taskforceai.test.cache"
	first := cachedAppleClient(audience)
	second := cachedAppleClient(audience)
	assert.Same(t, first, second)
}

func TestResolveAppleAudiencesExcludesExpoGoInProduction(t *testing.T) {
	for _, tc := range []struct {
		name    string
		nodeEnv string
		vercel  string
	}{
		{name: "node production", nodeEnv: "production"},
		{name: "vercel runtime", vercel: "1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("NODE_ENV", tc.nodeEnv)
			t.Setenv("GO_ENV", "")
			t.Setenv("VERCEL", tc.vercel)
			t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
			t.Setenv("APPLE_BUNDLE_ID", "com.taskforceai.mobile")
			t.Setenv("APPLE_ALLOWED_AUDIENCES", " host.exp.Exponent ,com.taskforceai.web ")

			got := resolveAppleAudiences()
			assert.Len(t, got, 2)
			assert.True(t, slices.Contains(got, "com.taskforceai.mobile"))
			assert.True(t, slices.Contains(got, "com.taskforceai.web"))
			assert.False(t, slices.Contains(got, "host.exp.Exponent"))
		})
	}
}

func TestExtractTokenAudience(t *testing.T) {
	makeToken := func(payload string) string {
		encoded := base64.RawURLEncoding.EncodeToString([]byte(payload))
		return "header." + encoded + ".signature"
	}

	t.Run("single audience", func(t *testing.T) {
		token := makeToken(`{"aud":"com.taskforceai.mobile"}`)
		assert.Equal(t, "com.taskforceai.mobile", extractTokenAudience(token))
	})

	t.Run("multiple audiences", func(t *testing.T) {
		token := makeToken(`{"aud":["com.taskforceai.mobile","host.exp.Exponent"]}`)
		assert.Equal(t, "com.taskforceai.mobile,host.exp.Exponent", extractTokenAudience(token))
	})

	t.Run("invalid token", func(t *testing.T) {
		assert.Empty(t, extractTokenAudience("not-a-jwt"))
		assert.Empty(t, extractTokenAudience("header.%%%bad.signature"))
		assert.Empty(t, extractTokenAudience(makeToken(`{`)))
		assert.Empty(t, extractTokenAudience(makeToken(`{"aud":123}`)))
		assert.Equal(t, "valid", extractTokenAudience(makeToken(`{"aud":["",123," valid "]}`)))
	})
}

func TestNormalizeOptional(t *testing.T) {
	assert.Empty(t, normalizeOptional(nil))
	value := "  Jane Doe  "
	assert.Equal(t, "Jane Doe", normalizeOptional(&value))
}

func TestAppleEmailVerified(t *testing.T) {
	assert.True(t, appleEmailVerified(true))
	assert.True(t, appleEmailVerified(" true "))
	assert.False(t, appleEmailVerified(false))
	assert.False(t, appleEmailVerified("false"))
	assert.False(t, appleEmailVerified(nil))
}

func verifiedAppleClaims(email string) *providers.AppleClaims {
	return &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "apple-sub"},
		Email:            email,
		EmailVerified:    true,
		Nonce:            "nonce",
	}
}

type appleNonceStoreStub struct {
	created bool
	err     error
	calls   int
}

func (s *appleNonceStoreStub) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	s.calls++
	return s.created, s.err
}

func TestAppleHandler_MethodNotAllowed(t *testing.T) {
	h := &AppleHandlerStruct{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/apple", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}

func TestAppleHandler_InvalidJSON(t *testing.T) {
	h := &AppleHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/apple", strings.NewReader("{"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestAppleHandler_MissingRequiredFields(t *testing.T) {
	h := &AppleHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/apple", strings.NewReader(`{"identityToken":"abc"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestAppleHandler_BlankRequiredFields(t *testing.T) {
	h := &AppleHandlerStruct{}
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"   ","authorizationCode":"  "}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestAppleHandler_BlankRequiredFieldsAfterTrim(t *testing.T) {
	h := &AppleHandlerStruct{}
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"   ","authorizationCode":"code","nonce":"   "}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "identityToken and nonce are required")
}

func TestAppleHandler_MissingConfig(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "")
	t.Setenv("APPLE_BUNDLE_ID", "")

	h := &AppleHandlerStruct{}
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"abc","authorizationCode":"def","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestAppleGlobalHandler(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "")
	t.Setenv("APPLE_BUNDLE_ID", "")
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"abc","authorizationCode":"def","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	Handler(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestVerifyAppleIdentityToken_NoAudiences(t *testing.T) {
	h := &AppleHandlerStruct{}
	claims, err := h.verifyAppleIdentityToken("token", nil)

	assert.Nil(t, claims)
	assert.ErrorContains(t, err, "no configured Apple audiences")
}

func TestAppleHandler_InvalidToken(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

	mockApple := provider_mocks.NewAppleProvider(t)
	mockApple.On("VerifyIdentityToken", "invalid").Return(nil, errors.New("bad token")).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"invalid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleHandler_InvalidNonce(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

	claims := verifiedAppleClaims("u@example.com")
	mockApple := provider_mocks.NewAppleProvider(t)
	mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			t.Fatal("database should not be reached when Apple nonce mismatches")
			return nil, nil
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"other-nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleHandler_ReplayedNonceRejected(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

	mockApple := provider_mocks.NewAppleProvider(t)
	mockApple.On("VerifyIdentityToken", "valid").Return(verifiedAppleClaims("u@example.com"), nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		NonceStore: &appleNonceStoreStub{
			created: false,
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			t.Fatal("database should not be reached when Apple nonce was already used")
			return nil, nil
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAppleHandler_NonceStoreUnavailable(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

	mockApple := provider_mocks.NewAppleProvider(t)
	mockApple.On("VerifyIdentityToken", "valid").Return(verifiedAppleClaims("u@example.com"), nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		NonceStore: &appleNonceStoreStub{
			err: errors.New("redis down"),
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			t.Fatal("database should not be reached when Apple nonce validation is unavailable")
			return nil, nil
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Contains(t, rr.Body.String(), "Apple auth temporarily unavailable")
}

func TestValidateAppleNonceBranches(t *testing.T) {
	t.Run("production requires nonce store", func(t *testing.T) {
		t.Setenv("NODE_ENV", "production")
		servicehandler.SetRedisClient(nil)
		t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

		err := (&AppleHandlerStruct{}).validateAppleNonce(context.Background(), verifiedAppleClaims("u@example.com"), "nonce")

		assert.ErrorIs(t, err, errAppleNonceUnavailable)
	})

	t.Run("stores nonce", func(t *testing.T) {
		store := &appleNonceStoreStub{created: true}
		err := (&AppleHandlerStruct{NonceStore: store}).validateAppleNonce(context.Background(), verifiedAppleClaims("u@example.com"), " nonce ")

		require.NoError(t, err)
		assert.Equal(t, 1, store.calls)
	})
}

func TestAppleHandler_DatabaseUnavailable(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

	mockApple := provider_mocks.NewAppleProvider(t)
	claims := verifiedAppleClaims("u@example.com")
	mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return nil, errors.New("db down")
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestAppleHandler_DisabledUser(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

	mockApple := provider_mocks.NewAppleProvider(t)
	claims := verifiedAppleClaims("u@example.com")
	mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *providers.AppleClaims, string, string) (*auth.AuthUser, error) {
			return nil, auth.ErrUserDisabled
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestAppleHandler_LinkUserErrors(t *testing.T) {
	for _, tc := range []struct {
		name       string
		err        error
		statusCode int
		body       string
	}{
		{name: "email required", err: errOAuthEmailRequired, statusCode: http.StatusBadRequest, body: "Email missing"},
		{name: "subject required", err: errOAuthSubjectRequired, statusCode: http.StatusUnauthorized, body: "Invalid token"},
		{name: "generic error", err: errors.New("mapping failed"), statusCode: http.StatusInternalServerError, body: "Failed to process account"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")

			mockApple := provider_mocks.NewAppleProvider(t)
			claims := verifiedAppleClaims("u@example.com")
			mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

			mockAudit := auth_mocks.NewAuditLogRepository(t)
			mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

			h := &AppleHandlerStruct{
				Apple:    mockApple,
				AuditLog: auth.NewAuditService(mockAudit),
				GetQueries: func(context.Context) (*db.Queries, error) {
					return &db.Queries{}, nil
				},
				LinkUser: func(context.Context, *db.Queries, *providers.AppleClaims, string, string) (*auth.AuthUser, error) {
					return nil, tc.err
				},
			}

			req := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/auth/apple",
				strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
			)
			rr := httptest.NewRecorder()

			h.ServeHTTP(rr, req)

			assert.Equal(t, tc.statusCode, rr.Code)
			assert.Contains(t, rr.Body.String(), tc.body)
		})
	}
}

func TestAppleHandler_Success(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")

	mockApple := provider_mocks.NewAppleProvider(t)
	claims := verifiedAppleClaims("user@example.com")
	mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *providers.AppleClaims, string, string) (*auth.AuthUser, error) {
			return &auth.AuthUser{
				ID:    42,
				Email: "user@example.com",
			}, nil
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var response struct {
		AccessToken string `json:"access_token"`
		User        any    `json:"user"`
	}
	err := json.Unmarshal(rr.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.NotEmpty(t, response.AccessToken)
	assert.NotNil(t, response.User)
}

func TestVerifyAppleIdentityToken_UsesInjectedProvider(t *testing.T) {
	mockApple := provider_mocks.NewAppleProvider(t)
	mockApple.On("VerifyIdentityToken", "token").Return(&providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "sub"},
		Email:            "user@example.com",
	}, nil)

	h := &AppleHandlerStruct{Apple: mockApple}
	claims, err := h.verifyAppleIdentityToken("token", nil)
	require.NoError(t, err)
	assert.Equal(t, "sub", claims.Subject)
}

func TestLogLoginHelpers_NilAudit(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	logLoginSuccess(req, &auth.AuthUser{ID: 1, Email: "user@example.com"}, nil)
	reason := "failed"
	logLoginFailure(req, nil, reason, nil)
}
