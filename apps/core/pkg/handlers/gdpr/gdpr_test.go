package gdpr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

// mockGdprService implements the Service interface for testing
type mockGdprService struct {
	findExportUserFunc    func(ctx context.Context, email string) (platform.GdprUser, error)
	findConversationsFunc func(ctx context.Context, email string) ([]platform.GdprConversation, error)
	findDeleteUserFunc    func(ctx context.Context, email string) (platform.GdprUser, error)
	deleteUserDataFunc    func(ctx context.Context, userID int32) error
}

func (m *mockGdprService) FindExportUserByEmail(ctx context.Context, email string) (platform.GdprUser, error) {
	if m.findExportUserFunc != nil {
		return m.findExportUserFunc(ctx, email)
	}
	return platform.GdprUser{}, nil
}

func (m *mockGdprService) FindConversationsByEmail(ctx context.Context, email string) ([]platform.GdprConversation, error) {
	if m.findConversationsFunc != nil {
		return m.findConversationsFunc(ctx, email)
	}
	return nil, nil
}

func (m *mockGdprService) FindDeleteUserByEmail(ctx context.Context, email string) (platform.GdprUser, error) {
	if m.findDeleteUserFunc != nil {
		return m.findDeleteUserFunc(ctx, email)
	}
	return platform.GdprUser{}, nil
}

func (m *mockGdprService) DeleteUserData(ctx context.Context, userID int32) error {
	if m.deleteUserDataFunc != nil {
		return m.deleteUserDataFunc(ctx, userID)
	}
	return nil
}

// setupTestRouter creates a test router with auth context injection
func setupTestRouter(svc Service, user *auth.AuthenticatedUser) *chi.Mux {
	r := chi.NewRouter()

	// Add middleware to inject auth context
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
	RegisterHandlers(api, svc)
	return r
}

func TestGdprExport_Success(t *testing.T) {
	fullName := "Test User"
	mockSvc := &mockGdprService{
		findExportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{
				ID:       1,
				Email:    email,
				FullName: &fullName,
			}, nil
		},
		findConversationsFunc: func(ctx context.Context, email string) ([]platform.GdprConversation, error) {
			return []platform.GdprConversation{
				{ID: 1, UserInput: "Hello"},
				{ID: 2, UserInput: "World"},
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/gdpr/export")

	var body map[string]any
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)

	assert.NotNil(t, body["user"])
	assert.NotNil(t, body["conversations"])
}

func TestGdprExport_Unauthorized(t *testing.T) {
	mockSvc := &mockGdprService{}
	router := setupTestRouter(mockSvc, nil) // No user

	req := httptest.NewRequest(http.MethodGet, "/api/v1/gdpr/export", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	// Huma validation returns 401 for Resolve errors
	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestGdprExport_UserFetchError(t *testing.T) {
	mockSvc := &mockGdprService{
		findExportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{}, errors.New("database error")
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/gdpr/export")
}

func TestGdprExport_ConversationsFetchError(t *testing.T) {
	mockSvc := &mockGdprService{
		findExportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 1, Email: email}, nil
		},
		findConversationsFunc: func(ctx context.Context, email string) ([]platform.GdprConversation, error) {
			return nil, errors.New("database error")
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/gdpr/export")
}

func TestGdprExport_Returns413WhenPayloadTooLarge(t *testing.T) {
	originalBudget := gdprExportPayloadBudgetBytes
	gdprExportPayloadBudgetBytes = 160
	t.Cleanup(func() { gdprExportPayloadBudgetBytes = originalBudget })

	mockSvc := &mockGdprService{
		findExportUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 1, Email: email}, nil
		},
		findConversationsFunc: func(ctx context.Context, email string) ([]platform.GdprConversation, error) {
			return []platform.GdprConversation{{ID: 1, UserInput: strings.Repeat("x", 200)}}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	handlertest.ServeStatus(t, router, http.StatusRequestEntityTooLarge, http.MethodGet, "/api/v1/gdpr/export")
}

func TestGdprDelete_Success(t *testing.T) {
	deleteUserCalled := false
	mockSvc := &mockGdprService{
		findDeleteUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 1, Email: email}, nil
		},
		deleteUserDataFunc: func(ctx context.Context, userID int32) error {
			deleteUserCalled = true
			assert.Equal(t, int32(1), userID)
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	reqBody, _ := json.Marshal(DeleteAccountRequest{ConfirmEmail: "test@example.com"})
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/gdpr/delete-account", bytes.NewBuffer(reqBody))
	assert.True(t, deleteUserCalled, "DeleteUserData should have been called")
}

func TestGdprDelete_Unauthorized(t *testing.T) {
	mockSvc := &mockGdprService{}
	router := setupTestRouter(mockSvc, nil)

	reqBody, _ := json.Marshal(DeleteAccountRequest{ConfirmEmail: "test@example.com"})
	handlertest.ServeStatus(t, router, http.StatusUnauthorized, http.MethodPost, "/api/v1/gdpr/delete-account", bytes.NewBuffer(reqBody))
}

func TestGdprDelete_EmailMismatch(t *testing.T) {
	mockSvc := &mockGdprService{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	// Confirm email doesn't match user email
	reqBody, _ := json.Marshal(DeleteAccountRequest{ConfirmEmail: "wrong@example.com"})
	handlertest.ServeStatus(t, router, http.StatusBadRequest, http.MethodPost, "/api/v1/gdpr/delete-account", bytes.NewBuffer(reqBody))
}

func TestGdprDelete_UserFetchError(t *testing.T) {
	mockSvc := &mockGdprService{
		findDeleteUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{}, errors.New("database error")
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	reqBody, _ := json.Marshal(DeleteAccountRequest{ConfirmEmail: "test@example.com"})
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/gdpr/delete-account", bytes.NewBuffer(reqBody))
}

func TestGdprDelete_DeleteError(t *testing.T) {
	mockSvc := &mockGdprService{
		findDeleteUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 1, Email: email}, nil
		},
		deleteUserDataFunc: func(ctx context.Context, userID int32) error {
			return errors.New("delete failed")
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupTestRouter(mockSvc, user)

	reqBody, _ := json.Marshal(DeleteAccountRequest{ConfirmEmail: "test@example.com"})
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/gdpr/delete-account", bytes.NewBuffer(reqBody))
}

// captureSlogHandler records structured log records for assertions in tests.
type captureSlogHandler struct {
	records []slog.Record
}

func (h *captureSlogHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }
func (h *captureSlogHandler) WithAttrs(_ []slog.Attr) slog.Handler         { return h }
func (h *captureSlogHandler) WithGroup(_ string) slog.Handler              { return h }
func (h *captureSlogHandler) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r)
	return nil
}

func TestGdprDelete_AuditLogOnSuccess(t *testing.T) {
	// Arrange: capture slog output
	capture := &captureSlogHandler{}
	original := slog.Default()
	slog.SetDefault(slog.New(capture))
	t.Cleanup(func() { slog.SetDefault(original) })

	mockSvc := &mockGdprService{
		findDeleteUserFunc: func(ctx context.Context, email string) (platform.GdprUser, error) {
			return platform.GdprUser{ID: 42, Email: email}, nil
		},
		deleteUserDataFunc: func(ctx context.Context, userID int32) error {
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 42, Email: "audit@example.com"}
	router := setupTestRouter(mockSvc, user)

	reqBody, _ := json.Marshal(DeleteAccountRequest{ConfirmEmail: "audit@example.com"})
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/gdpr/delete-account", bytes.NewBuffer(reqBody))

	// Assert: exactly one Info record with the expected message was emitted
	var found bool
	for _, r := range capture.records {
		if r.Level == slog.LevelInfo && r.Message == "GDPR delete completed: user data deleted" {
			found = true
			break
		}
	}
	assert.True(t, found, "expected 'GDPR delete completed' Info log to be emitted on successful deletion")
}
