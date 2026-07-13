package mobile

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type MockAppleProvider struct {
	mock.Mock
}

func (m *MockAppleProvider) VerifyIdentityToken(identityToken string) (*providers.AppleClaims, error) {
	args := m.Called(identityToken)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	res, ok := args.Get(0).(*providers.AppleClaims)
	if !ok {
		return nil, args.Error(1)
	}
	return res, args.Error(1)
}

func TestAppleHandler_Manual(t *testing.T) {
	mockApple := &MockAppleProvider{}
	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)

	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	claims := &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: "apple-sub-123",
		},
		Email:         "apple@example.com",
		EmailVerified: true,
		Nonce:         "nonce",
	}
	mockApple.On("VerifyIdentityToken", "valid-apple-token").Return(claims, nil)

	h := &AppleHandlerStruct{
		Apple:      mockApple,
		GetQueries: func(ctx context.Context) (*db.Queries, error) { return queries, nil },
		LinkUser: func(ctx context.Context, q *db.Queries, c *providers.AppleClaims, email, name string) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 2, Email: "apple@example.com"}, nil
		},
	}

	body, _ := json.Marshal(AppleAuthRequest{
		IdentityToken:     "valid-apple-token",
		AuthorizationCode: "valid-code",
		Nonce:             "nonce",
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/mobile/apple", strings.NewReader(string(body)))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestLinkOrCreateAppleUser_Mock(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)

	claims := &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: "apple-456",
		},
		Email:         "apple-user@example.com",
		EmailVerified: true,
	}

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("apple", "apple-456").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 2, Email: "apple-user@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectCommit()

	user, err := linkOrCreateAppleUser(context.Background(), queries, claims, "", "")
	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, "apple-user@example.com", user.Email)
}
