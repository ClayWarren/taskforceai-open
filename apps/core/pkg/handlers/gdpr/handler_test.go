package gdpr

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockGdprServiceV2 struct {
	exportUserFunc func(ctx context.Context, email string) (platform.GdprUser, error)
	convsFunc      func(ctx context.Context, email string) ([]platform.GdprConversation, error)
	deleteUserFunc func(ctx context.Context, email string) (platform.GdprUser, error)
	deleteDataFunc func(ctx context.Context, userID int32) error
}

func (m *mockGdprServiceV2) FindExportUserByEmail(ctx context.Context, email string) (platform.GdprUser, error) {
	return m.exportUserFunc(ctx, email)
}

func (m *mockGdprServiceV2) FindConversationsByEmail(ctx context.Context, email string) ([]platform.GdprConversation, error) {
	return m.convsFunc(ctx, email)
}

func (m *mockGdprServiceV2) FindDeleteUserByEmail(ctx context.Context, email string) (platform.GdprUser, error) {
	return m.deleteUserFunc(ctx, email)
}

func (m *mockGdprServiceV2) DeleteUserData(ctx context.Context, userID int32) error {
	return m.deleteDataFunc(ctx, userID)
}

func setupGdprRouter(service Service, user *auth.AuthenticatedUser) *chi.Mux {
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

func TestRegisterHandlers_GdprExport_Success(t *testing.T) {
	service := &mockGdprServiceV2{
		exportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 1, Email: email}, nil
		},
		convsFunc: func(ctx context.Context, email string) ([]platform.GdprConversation, error) {
			return []platform.GdprConversation{{ID: 1}}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupGdprRouter(service, user)

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/gdpr/export")
	require.Contains(t, resp.Body.String(), "conversations")
}

func TestRegisterHandlers_GdprExport_Error(t *testing.T) {
	service := &mockGdprServiceV2{
		exportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{}, errors.New("fail")
		},
		convsFunc: func(ctx context.Context, email string) ([]platform.GdprConversation, error) {
			return nil, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupGdprRouter(service, user)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/gdpr/export")
}

func TestRegisterHandlers_GdprExport_RejectsUserWithoutEmail(t *testing.T) {
	service := &mockGdprServiceV2{}
	user := &auth.AuthenticatedUser{ID: 1}
	router := setupGdprRouter(service, user)

	handlertest.ServeStatus(t, router, http.StatusUnauthorized, http.MethodGet, "/api/v1/gdpr/export")
}

func TestRegisterHandlers_GdprExport_PrepareError(t *testing.T) {
	originalEnsure := ensureGDPRExportWithinBudget
	ensureGDPRExportWithinBudget = func(value any, budgetBytes int) (int, error) {
		return 0, errors.New("marshal failed")
	}
	t.Cleanup(func() {
		ensureGDPRExportWithinBudget = originalEnsure
	})

	service := &mockGdprServiceV2{
		exportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 1, Email: email}, nil
		},
		convsFunc: func(ctx context.Context, email string) ([]platform.GdprConversation, error) {
			return []platform.GdprConversation{}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupGdprRouter(service, user)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/gdpr/export")
}

func TestRegisterHandlers_GdprDeleteAccount_EmailMismatch(t *testing.T) {
	service := &mockGdprServiceV2{}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupGdprRouter(service, user)

	body := `{"confirmEmail":"wrong@example.com"}`
	handlertest.ServeStatus(t, router, http.StatusBadRequest, http.MethodPost, "/api/v1/gdpr/delete-account", strings.NewReader(body))
}

func TestRegisterHandlers_GdprDeleteAccount_RejectsUserWithoutEmail(t *testing.T) {
	service := &mockGdprServiceV2{}
	user := &auth.AuthenticatedUser{ID: 1}
	router := setupGdprRouter(service, user)

	body := `{"confirmEmail":""}`
	handlertest.ServeStatus(t, router, http.StatusUnauthorized, http.MethodPost, "/api/v1/gdpr/delete-account", strings.NewReader(body))
}

func TestRegisterHandlers_GdprDeleteAccount_Success(t *testing.T) {
	service := &mockGdprServiceV2{
		deleteUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 42, Email: email}, nil
		},
		deleteDataFunc: func(ctx context.Context, userID int32) error {
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupGdprRouter(service, user)

	body := `{"confirmEmail":"test@example.com"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/gdpr/delete-account", strings.NewReader(body))
}

func TestRegisterHandlers_GdprDeleteAccount_DeleteError(t *testing.T) {
	service := &mockGdprServiceV2{
		deleteUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 42, Email: email}, nil
		},
		deleteDataFunc: func(ctx context.Context, userID int32) error {
			return errors.New("fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupGdprRouter(service, user)

	body := `{"confirmEmail":"test@example.com"}`
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/gdpr/delete-account", strings.NewReader(body))
}
