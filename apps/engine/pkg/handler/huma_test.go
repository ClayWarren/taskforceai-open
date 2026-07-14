package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
)

func TestAuthContext_ResolveUnauthorized(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))

	huma.Register(api, huma.Operation{
		OperationID: "auth-context",
		Method:      http.MethodGet,
		Path:        "/auth",
	}, func(ctx context.Context, input *struct{ adapterhandler.AuthContext }) (*struct{ Body map[string]bool }, error) {
		return &struct{ Body map[string]bool }{Body: map[string]bool{"ok": true}}, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/auth", nil)
	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestAuthContext_ResolveSuccess(t *testing.T) {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
			ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
			ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, 7)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))

	huma.Register(api, huma.Operation{
		OperationID: "auth-context",
		Method:      http.MethodGet,
		Path:        "/auth",
	}, func(ctx context.Context, input *struct{ adapterhandler.AuthContext }) (*struct{ Body map[string]int }, error) {
		return &struct{ Body map[string]int }{Body: map[string]int{"org": input.OrgID}}, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/auth", nil)
	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestOptionalAuthContext_AllowsMissingUser(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))

	huma.Register(api, huma.Operation{
		OperationID: "optional-auth",
		Method:      http.MethodGet,
		Path:        "/optional",
	}, func(ctx context.Context, input *struct {
		adapterhandler.OptionalAuthContext
	}) (*struct{ Body map[string]bool }, error) {
		return &struct{ Body map[string]bool }{Body: map[string]bool{"ok": true}}, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/optional", nil)
	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}
