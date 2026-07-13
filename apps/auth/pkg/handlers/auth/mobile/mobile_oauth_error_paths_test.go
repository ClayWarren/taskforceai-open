package mobile

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	provider_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
	"google.golang.org/api/idtoken"
)

func TestMobileCORS(t *testing.T) {
	for _, tc := range []struct {
		name    string
		handler http.Handler
		path    string
	}{
		{name: "apple", handler: &AppleHandlerStruct{}, path: "/api/v1/auth/apple"},
		{name: "google", handler: &GoogleHandlerStruct{}, path: "/api/v1/auth/google"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			tc.handler.ServeHTTP(rr, httptest.NewRequest(http.MethodOptions, tc.path, nil))
			assert.Equal(t, http.StatusNoContent, rr.Code)
		})
	}
}

func TestAppleHandlerDefaultsAndFallbackVerification(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")
	mockApple := provider_mocks.NewAppleProvider(t)
	claims := &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "apple-sub"},
		Email:            "apple@example.com",
		EmailVerified:    true,
		Nonce:            "nonce",
	}
	mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

	originalNewApple := newAppleClient
	originalQueries := defaultAppleQueries
	originalLink := defaultLinkAppleUser
	newAppleClient = func(string) providers.AppleProvider { return mockApple }
	defaultAppleQueries = func(context.Context) (*db.Queries, error) { return &db.Queries{}, nil }
	defaultLinkAppleUser = func(context.Context, *db.Queries, *providers.AppleClaims, string, string) (*auth.AuthUser, error) {
		return &auth.AuthUser{ID: 1, Email: "apple@example.com", MFAEnabled: true}, nil
	}
	t.Cleanup(func() {
		newAppleClient = originalNewApple
		defaultAppleQueries = originalQueries
		defaultLinkAppleUser = originalLink
	})

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()
	(&AppleHandlerStruct{}).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"mfa_required":true`)
}

func TestExtractTokenAudienceMissingAudience(t *testing.T) {
	token := "header." + base64.RawURLEncoding.EncodeToString([]byte(`{}`)) + ".signature"
	assert.Empty(t, extractTokenAudience(token))
}

func TestGoogleHandlerDefaults(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")
	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")
	mockGoogle := provider_mocks.NewGoogleProvider(t)
	mockGoogle.On("ValidateIDToken", mock.Anything, "good", "google-client-id").Return(&idtoken.Payload{
		Subject: "google-sub",
		Claims:  map[string]any{"email": "google@example.com", "email_verified": true},
	}, nil).Once()

	originalNewGoogle := newGoogleClient
	originalQueries := defaultGoogleQueries
	originalLink := defaultLinkGoogleUser
	newGoogleClient = func(*oauth2.Config) providers.GoogleProvider { return mockGoogle }
	defaultGoogleQueries = func(context.Context) (*db.Queries, error) { return &db.Queries{}, nil }
	defaultLinkGoogleUser = func(context.Context, *db.Queries, *idtoken.Payload) (*auth.AuthUser, error) {
		return &auth.AuthUser{ID: 2, Email: "google@example.com", MFAEnabled: true}, nil
	}
	t.Cleanup(func() {
		newGoogleClient = originalNewGoogle
		defaultGoogleQueries = originalQueries
		defaultLinkGoogleUser = originalLink
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"good"}`))
	rr := httptest.NewRecorder()
	(&GoogleHandlerStruct{}).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"mfa_required":true`)
}

func TestNewGoogleClientDefault(t *testing.T) {
	assert.NotNil(t, newGoogleClient(nil))
}

func TestGoogleEmailBranches(t *testing.T) {
	_, err := verifiedGoogleEmail(map[string]any{"email_verified": true})
	require.ErrorIs(t, err, errOAuthEmailRequired)

	_, err = verifiedGoogleEmail(map[string]any{"email_verified": true, "email": 123})
	require.ErrorIs(t, err, errOAuthEmailRequired)

	_, err = verifiedGoogleEmail(map[string]any{"email_verified": true, "email": "   "})
	require.ErrorIs(t, err, errOAuthEmailRequired)

	assert.False(t, googleEmailVerified(map[string]any{"email_verified": 1}))
}

func TestWriteMobileSessionResponseMFABranches(t *testing.T) {
	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")
	user := &auth.AuthUser{ID: 3, Email: "mfa@example.com", MFAEnabled: true}
	rr := httptest.NewRecorder()
	writeMobileSessionResponse(rr, httptest.NewRequest(http.MethodPost, "/", nil), user, nil, "Google")
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"mfa_required":true`)

	t.Setenv("AUTH_SECRET", "")
	rr = httptest.NewRecorder()
	writeMobileSessionResponse(rr, httptest.NewRequest(http.MethodPost, "/", nil), user, nil, "Google")
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestLinkOrCreateOAuthUserErrors(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	t.Run("account lookup error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		q := db.New(mockPool)
		mockPool.ExpectBegin()
		mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
			WithArgs("google", "sub-error").
			WillReturnError(errors.New("lookup failed"))
		mockPool.ExpectRollback()

		user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
			Provider:          "google",
			ProviderAccountID: "sub-error",
			Email:             "user@example.com",
		})

		assert.Nil(t, user)
		require.Error(t, err)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("email lookup error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		q := db.New(mockPool)
		mockPool.ExpectBegin()
		mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
			WithArgs("google", "sub-email").
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
			WithArgs("user@example.com").
			WillReturnError(errors.New("email lookup failed"))
		mockPool.ExpectRollback()

		user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
			Provider:          "google",
			ProviderAccountID: "sub-email",
			Email:             "user@example.com",
		})

		assert.Nil(t, user)
		require.Error(t, err)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("create user error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		q := db.New(mockPool)
		mockPool.ExpectBegin()
		mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
			WithArgs("google", "sub-create").
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
			WithArgs("new@example.com").
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("INSERT INTO users").
			WithArgs("new@example.com", pgxmock.AnyArg(), "free").
			WillReturnError(errors.New("create failed"))
		mockPool.ExpectRollback()

		user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
			Provider:          "google",
			ProviderAccountID: "sub-create",
			Email:             "new@example.com",
			FullName:          "New User",
		})

		assert.Nil(t, user)
		require.Error(t, err)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("disabled email user", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		q := db.New(mockPool)
		mockPool.ExpectBegin()
		mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
			WithArgs("google", "sub-disabled").
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
			WithArgs("disabled@example.com").
			WillReturnRows(dbtest.UserRow(dbtest.User{ID: 4, Email: "disabled@example.com", Disabled: true}))
		mockPool.ExpectRollback()

		user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
			Provider:          "google",
			ProviderAccountID: "sub-disabled",
			Email:             "disabled@example.com",
		})

		assert.Nil(t, user)
		require.ErrorIs(t, err, auth.ErrUserDisabled)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("create account error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		q := db.New(mockPool)
		mockPool.ExpectBegin()
		mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
			WithArgs("google", "sub-account").
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
			WithArgs("linked@example.com").
			WillReturnRows(dbtest.UserRow(dbtest.User{ID: 5, Email: "linked@example.com"}))
		mockPool.ExpectQuery("INSERT INTO accounts").
			WithArgs(pgxmock.AnyArg(), int32(5), "oauth", "google", "sub-account", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(errors.New("account create failed"))
		mockPool.ExpectRollback()

		user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
			Provider:          "google",
			ProviderAccountID: "sub-account",
			Email:             "linked@example.com",
		})

		assert.Nil(t, user)
		require.Error(t, err)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})
}
