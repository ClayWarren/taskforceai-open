package mobile

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
	"google.golang.org/api/idtoken"
)

type MockGoogleProvider struct {
	mock.Mock
}

func (m *MockGoogleProvider) ValidateIDToken(ctx context.Context, idToken, audience string) (*idtoken.Payload, error) {
	args := m.Called(ctx, idToken, audience)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, ok := args.Get(0).(*idtoken.Payload)
	if !ok {
		return nil, args.Error(1)
	}
	return res, args.Error(1)
}

func (m *MockGoogleProvider) GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return m.Called(state, opts).String(0)
}

func (m *MockGoogleProvider) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	args := m.Called(ctx, code, opts)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, ok := args.Get(0).(*oauth2.Token)
	if !ok {
		return nil, args.Error(1)
	}
	return res, args.Error(1)
}

func (m *MockGoogleProvider) GetUserInfo(ctx context.Context, token *oauth2.Token) (*providers.GoogleUser, error) {
	args := m.Called(ctx, token)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, ok := args.Get(0).(*providers.GoogleUser)
	if !ok {
		return nil, args.Error(1)
	}
	return res, args.Error(1)
}

func TestLinkOrCreateGoogleUser_Mock(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)

	payload := &idtoken.Payload{
		Subject: "google-123",
		Claims: map[string]any{
			"email":          "google@example.com",
			"email_verified": true,
			"name":           "Google User",
		},
	}

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("google", "google-123").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "google@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectCommit()

	user, err := linkOrCreateGoogleUser(context.Background(), queries, payload)
	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, "google@example.com", user.Email)
}

func TestGoogleHandler_Manual(t *testing.T) {
	mockGoogle := &MockGoogleProvider{}
	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)

	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	payload := &idtoken.Payload{
		Subject: "google-123",
		Claims: map[string]any{
			"email": "google@example.com",
			"name":  "Google User",
		},
	}
	mockGoogle.On("ValidateIDToken", mock.Anything, "valid-token", "client-id").Return(payload, nil)

	h := &GoogleHandlerStruct{
		Google:     mockGoogle,
		GetQueries: func(ctx context.Context) (*db.Queries, error) { return queries, nil },
		LinkUser: func(ctx context.Context, q *db.Queries, p *idtoken.Payload) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: "google@example.com"}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/auth/mobile/google", strings.NewReader(`{"idToken":"valid-token"}`))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestGoogleHandler_Constructor(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	GoogleHandler(rr, req)
}

func TestGoogleHandler_ErrorCases_Manual(t *testing.T) {
	h := &GoogleHandlerStruct{}

	// 1. Method Not Allowed
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)

	// 2. Missing ID Token
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
