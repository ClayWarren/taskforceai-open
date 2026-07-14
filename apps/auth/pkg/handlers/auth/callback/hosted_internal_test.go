package callback

import (
	"context"
	"errors"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	provider_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
	"net/http"
	"net/http/httptest"
	"testing"
)

const hostedTestAuthSecret = "this-is-a-long-enough-secret-key-123"

func hostedSuccessRequest(t *testing.T) *http.Request {
	t.Helper()
	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "/dashboard", hostedTestAuthSecret)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	return req
}

func TestHostedHandler_EncodeSessionFailure(t *testing.T) {
	req := hostedSuccessRequest(t)
	t.Setenv("AUTH_SECRET", "")
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(context.Context, *db.Queries, usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: "user@example.com"}, nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestHostedHandler_LinkUserDisabled(t *testing.T) {
	t.Setenv("AUTH_SECRET", hostedTestAuthSecret)
	req := hostedSuccessRequest(t)
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "disabled@example.com"},
	}, nil)

	h := &HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(context.Context, *db.Queries, usermanagement.User) (*auth.AuthUser, error) {
			return nil, auth.ErrUserDisabled
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestHostedHandler_LinkUserErrorWithAudit(t *testing.T) {
	t.Setenv("AUTH_SECRET", hostedTestAuthSecret)
	req := hostedSuccessRequest(t)
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)
	mockAudit := new(auth_mocks.AuditLogRepository)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil)

	h := &HostedHandlerStruct{
		WorkOS:      mockWorkOS,
		AuditLogger: auth.NewAuditService(mockAudit),
		LinkUser: func(context.Context, *db.Queries, usermanagement.User) (*auth.AuthUser, error) {
			return nil, errors.New("link failed")
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	mockAudit.AssertExpectations(t)
}

func TestHostedHandler_MissingConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		client string
		key    string
		dbURL  string
	}{
		{"missing client", "", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "postgres://localhost"},
		{"missing encryption key", "client", "", "postgres://localhost"},
		{"missing database url", "client", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("WORKOS_CLIENT_ID", tt.client)
			t.Setenv("ENCRYPTION_KEY", tt.key)
			t.Setenv("DATABASE_URL", tt.dbURL)

			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback", nil)
			rr := httptest.NewRecorder()
			HostedHandler(rr, req)
			assert.Equal(t, http.StatusInternalServerError, rr.Code)
		})
	}
}

func TestHostedHandler_QueriesUnavailable(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client")
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://localhost")

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()
	HostedHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestLinkOrCreateWorkOSUserNilQueries(t *testing.T) {
	user, err := linkOrCreateWorkOSUser(t.Context(), nil, usermanagement.User{Email: "user@example.com"})
	if err == nil {
		t.Fatal("expected error")
	}
	if user != nil {
		t.Fatalf("expected nil user, got %#v", user)
	}
}

func TestLinkOrCreateWorkOSUser_GetPoolError(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://invalid-host:1/nope?sslmode=disable")

	mock := dbtest.NewMockPool(t)

	user, err := linkOrCreateWorkOSUser(context.Background(), db.New(mock), usermanagement.User{
		ID:    "workos-1",
		Email: "user@example.com",
	})
	require.Error(t, err)
	assert.Nil(t, user)
}

func TestShouldUseSecureCookies(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	if !shouldUseSecureCookies(nil) {
		t.Fatal("expected production to use secure cookies")
	}

	t.Setenv("NODE_ENV", "")
	t.Setenv("VERCEL", "1")
	if !shouldUseSecureCookies(nil) {
		t.Fatal("expected Vercel to use secure cookies")
	}

	t.Setenv("VERCEL", "")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-Proto", "https, http")
	if !shouldUseSecureCookies(req) {
		t.Fatal("expected forwarded HTTPS to use secure cookies")
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	if shouldUseSecureCookies(req) {
		t.Fatal("expected plain HTTP request to avoid secure cookies")
	}
}
