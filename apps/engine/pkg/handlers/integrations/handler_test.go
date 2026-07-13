package integrations

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	integrations "github.com/TaskForceAI/go-engine/pkg/integrations"
)

type integrationsServiceFake struct {
	statuses []integrations.IntegrationStatus
	listErr  error
	discErr  error
	deleted  []string
}

func (f *integrationsServiceFake) ListIntegrations(ctx context.Context, userID int32) ([]integrations.IntegrationStatus, error) {
	return f.statuses, f.listErr
}

func (f *integrationsServiceFake) Disconnect(ctx context.Context, userID int32, provider string) error {
	f.deleted = append(f.deleted, provider)
	return f.discErr
}

func setupIntegrationsRouter(service integrations.Service, user *auth.AuthenticatedUser) *chi.Mux {
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

func TestListIntegrations_Success(t *testing.T) {
	service := &integrationsServiceFake{
		statuses: []integrations.IntegrationStatus{{ID: "1", Provider: "google-drive", Connected: true}},
	}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupIntegrationsRouter(service, user)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/integrations", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "google-drive")
}

func TestListIntegrations_Error(t *testing.T) {
	service := &integrationsServiceFake{listErr: errors.New("fail")}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupIntegrationsRouter(service, user)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/integrations", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDisconnectIntegration_Success(t *testing.T) {
	service := &integrationsServiceFake{}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupIntegrationsRouter(service, user)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/integrations/google-drive", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, []string{"google-drive"}, service.deleted)
}

func TestDisconnectIntegration_Error(t *testing.T) {
	service := &integrationsServiceFake{discErr: errors.New("fail")}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupIntegrationsRouter(service, user)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/integrations/google-drive", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestListIntegrations_Unauthorized(t *testing.T) {
	service := &integrationsServiceFake{}
	router := setupIntegrationsRouter(service, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/integrations", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestDisconnectIntegration_Unauthorized(t *testing.T) {
	service := &integrationsServiceFake{}
	router := setupIntegrationsRouter(service, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/integrations/google-drive", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestIntegrationsRejectInvalidAuthIDBeforeService(t *testing.T) {
	service := &integrationsServiceFake{}
	router := setupIntegrationsRouter(service, &auth.AuthenticatedUser{ID: math.MaxInt32 + 1})

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/integrations"},
		{name: "disconnect", method: http.MethodDelete, path: "/api/v1/integrations/google-drive"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusBadRequest, resp.Code)
		})
	}
	assert.Empty(t, service.deleted)
}
