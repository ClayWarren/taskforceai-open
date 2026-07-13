package notifications

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/notifications"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockPushTokenService struct {
	registerFunc   func(ctx context.Context, input notifications.RegisterPushTokenInput) error
	unregisterFunc func(ctx context.Context, userID int, token string) (int, error)
}

func (m *mockPushTokenService) RegisterToken(ctx context.Context, input notifications.RegisterPushTokenInput) error {
	if m.registerFunc != nil {
		return m.registerFunc(ctx, input)
	}
	return nil
}

func (m *mockPushTokenService) UnregisterToken(ctx context.Context, userID int, token string) (int, error) {
	if m.unregisterFunc != nil {
		return m.unregisterFunc(ctx, userID, token)
	}
	return 1, nil
}

func setupNotificationsRouter(service *mockPushTokenService, user *auth.AuthenticatedUser) *chi.Mux {
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
	RegisterHandlers(api, service)
	return r
}

func TestRegisterPushToken_Success(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 33, Email: "test@example.com"}
	service := &mockPushTokenService{
		registerFunc: func(ctx context.Context, input notifications.RegisterPushTokenInput) error {
			if input.UserID != 33 || input.Token != "tok" || input.Platform != "ios" {
				return errors.New("bad input")
			}
			return nil
		},
	}

	router := setupNotificationsRouter(service, user)
	body := `{"token":"tok","platform":"ios"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/notifications/push-tokens", strings.NewReader(body))
}

func TestRegisterPushToken_ServiceError(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 33, Email: "test@example.com"}
	service := &mockPushTokenService{
		registerFunc: func(ctx context.Context, input notifications.RegisterPushTokenInput) error {
			return errors.New("fail")
		},
	}

	router := setupNotificationsRouter(service, user)
	body := `{"token":"tok","platform":"ios"}`
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/notifications/push-tokens", strings.NewReader(body))
}

func TestUnregisterPushToken_Success(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 33, Email: "test@example.com"}
	service := &mockPushTokenService{
		unregisterFunc: func(ctx context.Context, userID int, token string) (int, error) {
			if userID != 33 || token != "tok" {
				return 0, errors.New("bad input")
			}
			return 1, nil
		},
	}

	router := setupNotificationsRouter(service, user)
	body := `{"token":"tok"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodDelete, "/api/v1/notifications/push-tokens", strings.NewReader(body))
}

func TestUnregisterPushToken_ServiceError(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 33, Email: "test@example.com"}
	service := &mockPushTokenService{
		unregisterFunc: func(ctx context.Context, userID int, token string) (int, error) {
			return 0, errors.New("fail")
		},
	}

	router := setupNotificationsRouter(service, user)
	body := `{"token":"tok"}`
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodDelete, "/api/v1/notifications/push-tokens", strings.NewReader(body))
}

func TestRegisterPushToken_InvalidToken(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 33, Email: "test@example.com"}
	service := &mockPushTokenService{}
	router := setupNotificationsRouter(service, user)

	handlertest.ServeStatus(t, router, http.StatusUnprocessableEntity, http.MethodPost, "/api/v1/notifications/push-tokens", strings.NewReader(`{"token":"","platform":"ios"}`))
}
