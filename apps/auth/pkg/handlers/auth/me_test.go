package auth_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/auth"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	auth_handler "github.com/TaskForceAI/auth-service/pkg/handlers/auth"
)

func setupTestRouter(repo auth.AuthUserRepository, user *adapterauth.AuthenticatedUser) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})

	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	auth_handler.RegisterMeHandler(api, repo)
	return r
}

func TestMeHandler_Success(t *testing.T) {
	fullName := "Test User"
	subSource := "stripe"
	now := time.Now()

	mockRepo := new(auth_mocks.AuthUserRepository)
	mockRepo.On("FindByID", mock.Anything, 1).Return(&auth.AuthUser{
		ID:                   1,
		Email:                "test@example.com",
		FullName:             &fullName,
		Plan:                 new("pro"),
		SubscriptionSource:   &subSource,
		LastMessageTimestamp: &now,
		CurrentPeriodStart:   &now,
		CurrentPeriodEnd:     &now,
		Disabled:             false,
		IsAdmin:              true,
	}, nil)

	user := &adapterauth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockRepo, user)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "test@example.com")
}

func TestRegisterHandlers(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	mockRepo := new(auth_mocks.AuthUserRepository)
	auth_handler.RegisterHandlers(api, mockRepo)
}

func TestMeHandler_GetUserError(t *testing.T) {
	mockRepo := new(auth_mocks.AuthUserRepository)
	mockRepo.On("FindByID", mock.Anything, 1).Return(nil, errors.New("db error"))

	user := &adapterauth.AuthenticatedUser{ID: 1}
	router := setupTestRouter(mockRepo, user)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestMeHandler_UserNotFound(t *testing.T) {
	mockRepo := new(auth_mocks.AuthUserRepository)
	mockRepo.On("FindByID", mock.Anything, 99).Return(nil, auth.ErrUserNotFound)

	user := &adapterauth.AuthenticatedUser{ID: 99, Email: "missing@example.com"}
	router := setupTestRouter(mockRepo, user)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestMeHandler_NilUserIsNotFound(t *testing.T) {
	mockRepo := new(auth_mocks.AuthUserRepository)
	mockRepo.On("FindByID", mock.Anything, 99).Return(nil, nil)

	user := &adapterauth.AuthenticatedUser{ID: 99, Email: "missing@example.com"}
	router := setupTestRouter(mockRepo, user)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestMeHandler_Unauthorized(t *testing.T) {
	mockRepo := new(auth_mocks.AuthUserRepository)
	router := setupTestRouter(mockRepo, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}
