package mobile

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	provider_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/idtoken"
)

func TestGoogleHandler_MethodNotAllowed(t *testing.T) {
	h := &GoogleHandlerStruct{}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/google", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}

func TestGoogleHandler_InvalidJSON(t *testing.T) {
	h := &GoogleHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader("{"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestGoogleHandler_MissingIDToken(t *testing.T) {
	h := &GoogleHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"accessToken":"abc"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestGoogleHandler_BlankIDToken(t *testing.T) {
	h := &GoogleHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"   "}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestGoogleHandler_MissingConfig(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "")

	h := &GoogleHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"abc"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestGoogleHandler_InvalidToken(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")

	mockGoogle := provider_mocks.NewGoogleProvider(t)
	mockGoogle.On("ValidateIDToken", mock.Anything, "bad", "google-client-id").Return(nil, errors.New("invalid")).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &GoogleHandlerStruct{
		Google:   mockGoogle,
		AuditLog: auth.NewAuditService(mockAudit),
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"bad"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestGoogleHandler_DatabaseUnavailable(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")

	mockGoogle := provider_mocks.NewGoogleProvider(t)
	mockGoogle.On("ValidateIDToken", mock.Anything, "good", "google-client-id").Return(&idtoken.Payload{
		Subject: "google-sub-1",
		Claims: map[string]any{
			"email": "user@example.com",
		},
	}, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &GoogleHandlerStruct{
		Google:   mockGoogle,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return nil, errors.New("db down")
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"good"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestGoogleHandler_DisabledUser(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")

	mockGoogle := provider_mocks.NewGoogleProvider(t)
	mockGoogle.On("ValidateIDToken", mock.Anything, "good", "google-client-id").Return(&idtoken.Payload{
		Subject: "google-sub-1",
		Claims: map[string]any{
			"email": "user@example.com",
		},
	}, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &GoogleHandlerStruct{
		Google:   mockGoogle,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *idtoken.Payload) (*auth.AuthUser, error) {
			return nil, auth.ErrUserDisabled
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"good"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestGoogleHandler_LinkUserErrors(t *testing.T) {
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
			t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")

			mockGoogle := provider_mocks.NewGoogleProvider(t)
			mockGoogle.On("ValidateIDToken", mock.Anything, "good", "google-client-id").Return(&idtoken.Payload{
				Subject: "google-sub-1",
				Claims:  map[string]any{"email": "user@example.com"},
			}, nil).Once()

			mockAudit := auth_mocks.NewAuditLogRepository(t)
			mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

			h := &GoogleHandlerStruct{
				Google:   mockGoogle,
				AuditLog: auth.NewAuditService(mockAudit),
				GetQueries: func(context.Context) (*db.Queries, error) {
					return &db.Queries{}, nil
				},
				LinkUser: func(context.Context, *db.Queries, *idtoken.Payload) (*auth.AuthUser, error) {
					return nil, tc.err
				},
			}
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"good"}`))
			rr := httptest.NewRecorder()

			h.ServeHTTP(rr, req)

			assert.Equal(t, tc.statusCode, rr.Code)
			assert.Contains(t, rr.Body.String(), tc.body)
		})
	}
}

func TestGoogleHandler_SessionTokenFailure(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")
	t.Setenv("AUTH_SECRET", "")
	mockGoogle := provider_mocks.NewGoogleProvider(t)
	mockGoogle.On("ValidateIDToken", mock.Anything, "good", "google-client-id").Return(&idtoken.Payload{
		Subject: "google-sub-1",
		Claims:  map[string]any{"email": "user@example.com"},
	}, nil).Once()
	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &GoogleHandlerStruct{
		Google:   mockGoogle,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *idtoken.Payload) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 7, Email: "user@example.com"}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"good"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestGoogleHandler_Success(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id")
	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")

	mockGoogle := provider_mocks.NewGoogleProvider(t)
	mockGoogle.On("ValidateIDToken", mock.Anything, "good", "google-client-id").Return(&idtoken.Payload{
		Subject: "google-sub-1",
		Claims: map[string]any{
			"email": "user@example.com",
			"name":  "User Name",
		},
	}, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &GoogleHandlerStruct{
		Google:   mockGoogle,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *idtoken.Payload) (*auth.AuthUser, error) {
			return &auth.AuthUser{
				ID:    7,
				Email: "user@example.com",
			}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"good","accessToken":"a"}`))
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

func TestGoogleHandler_MultipleAudiences(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "web-id")
	t.Setenv("GOOGLE_IOS_CLIENT_ID", "ios-id")
	t.Setenv("GOOGLE_ANDROID_CLIENT_ID", "android-id")
	t.Setenv("AUTH_SECRET", "this-is-a-long-enough-secret-key-123")

	mockGoogle := provider_mocks.NewGoogleProvider(t)
	// Mock that it fails for Web ID but succeeds for iOS ID
	mockGoogle.On("ValidateIDToken", mock.Anything, "ios-token", "web-id").Return(nil, errors.New("mismatch")).Once()
	mockGoogle.On("ValidateIDToken", mock.Anything, "ios-token", "ios-id").Return(&idtoken.Payload{
		Subject: "google-sub-1",
		Claims: map[string]any{
			"email": "user@example.com",
		},
	}, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &GoogleHandlerStruct{
		Google:   mockGoogle,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *idtoken.Payload) (*auth.AuthUser, error) {
			return &auth.AuthUser{
				ID:    7,
				Email: "user@example.com",
			}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", strings.NewReader(`{"idToken":"ios-token"}`))
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

func TestLinkOrCreateGoogleUser_InputValidation(t *testing.T) {
	user, err := linkOrCreateGoogleUser(context.Background(), &db.Queries{}, nil)
	assert.Nil(t, user)
	require.ErrorContains(t, err, "payload is required")

	user, err = linkOrCreateGoogleUser(context.Background(), nil, &idtoken.Payload{
		Subject: "sub",
		Claims:  map[string]any{"email": "not-an-email", "email_verified": true},
	})
	assert.Nil(t, user)
	assert.ErrorIs(t, err, errOAuthEmailRequired)
}

func TestLinkOrCreateGoogleUser_UnverifiedEmailDoesNotLinkByEmail(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("google", "sub-unverified").
		WillReturnRows(pgxmock.NewRows(dbtest.UserColumns()))
	mockPool.ExpectRollback()

	user, err := linkOrCreateGoogleUser(context.Background(), queries, &idtoken.Payload{
		Subject: "sub-unverified",
		Claims: map[string]any{
			"email":          "claimed@example.com",
			"email_verified": false,
		},
	})

	assert.Nil(t, user)
	require.ErrorIs(t, err, errOAuthEmailRequired)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestGoogleEmailVerified(t *testing.T) {
	assert.True(t, googleEmailVerified(map[string]any{"email_verified": true}))
	assert.True(t, googleEmailVerified(map[string]any{"email_verified": "true"}))
	assert.False(t, googleEmailVerified(map[string]any{"email_verified": false}))
	assert.False(t, googleEmailVerified(map[string]any{"email_verified": "false"}))
	assert.False(t, googleEmailVerified(map[string]any{}))
}
