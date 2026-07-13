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
	"github.com/TaskForceAI/adapters/pkg/handler"
)

func TestAuthContext_Resolve(t *testing.T) {
	register := func(r *chi.Mux) {
		api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
		huma.Register(api, huma.Operation{Method: http.MethodGet, Path: "/auth"}, func(ctx context.Context, input *struct {
			handler.AuthContext
		}) (*struct{ Body map[string]any }, error) {
			return &struct{ Body map[string]any }{Body: map[string]any{"email": input.User.Email}}, nil
		})
	}

	// Unauthorized
	{
		r := chi.NewRouter()
		register(r)
		req := httptest.NewRequest(http.MethodGet, "/auth", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
	}

	// Authorized
	{
		r := chi.NewRouter()
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ctx := context.WithValue(r.Context(), handler.UserContextKey, &auth.AuthenticatedUser{Email: "user@example.com"})
				next.ServeHTTP(w, r.WithContext(ctx))
			})
		})
		register(r)
		req := httptest.NewRequest(http.MethodGet, "/auth", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	}
}

func TestOptionalAuthContext_Resolve(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))

	huma.Register(api, huma.Operation{Method: http.MethodGet, Path: "/opt"}, func(ctx context.Context, input *struct {
		handler.OptionalAuthContext
	}) (*struct{ Body map[string]any }, error) {
		ok := input.User != nil
		return &struct{ Body map[string]any }{Body: map[string]any{"ok": ok}}, nil
	})

	req := httptest.NewRequest(http.MethodGet, "/opt", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}
