package gdpr

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/danielgtaylor/huma/v2"
)

// DeleteAccountRequest represents a request to delete an account.
type DeleteAccountRequest struct {
	ConfirmEmail string `json:"confirmEmail" doc:"Email address to confirm deletion"`
}

// Service defines the GDPR service operations required by the handlers.
type Service interface {
	FindExportUserByEmail(ctx context.Context, email string) (platform.GdprUser, error)
	FindConversationsByEmail(ctx context.Context, email string) ([]platform.GdprConversation, error)
	FindDeleteUserByEmail(ctx context.Context, email string) (platform.GdprUser, error)
	DeleteUserData(ctx context.Context, userID int32) error
}

var gdprExportPayloadBudgetBytes = server.VercelFunctionSafeJSONPayloadBytes
var ensureGDPRExportWithinBudget = server.EnsureJSONPayloadWithinBudget

// RegisterHandlers registers GDPR related handlers.
func RegisterHandlers(api huma.API, svc Service) {
	// Export Data
	huma.Register(api, huma.Operation{
		OperationID: "gdpr-export-data",
		Method:      http.MethodGet,
		Path:        "/api/v1/gdpr/export",
		Summary:     "Export user data (GDPR)",
		Tags:        []string{"GDPR"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct{ Body map[string]any }, error) {
		if input.User.Email == "" {
			return nil, huma.Error401Unauthorized("Unauthorized")
		}

		exportUser, err := svc.FindExportUserByEmail(ctx, input.User.Email)
		if err != nil {
			slog.Error("GDPR export failed: failed to find user", "email", input.User.Email, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch user data")
		}

		convs, err := svc.FindConversationsByEmail(ctx, input.User.Email)
		if err != nil {
			slog.Error("GDPR export failed: failed to fetch conversations", "email", input.User.Email, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch conversations")
		}

		export := map[string]any{
			"user":          exportUser,
			"conversations": convs,
			"exportedAt":    time.Now(),
		}
		if _, err := ensureGDPRExportWithinBudget(export, gdprExportPayloadBudgetBytes); err != nil {
			slog.Error("GDPR export exceeds payload budget", "email", input.User.Email, "error", err)
			if errors.Is(err, server.ErrPayloadBudgetExceeded) {
				return nil, server.PayloadTooLargeError("GDPR export is too large for inline download")
			}
			return nil, huma.Error500InternalServerError("Failed to prepare export")
		}

		return &struct{ Body map[string]any }{Body: export}, nil
	})

	// Delete Account
	huma.Register(api, huma.Operation{
		OperationID: "gdpr-delete-account",
		Method:      http.MethodPost,
		Path:        "/api/v1/gdpr/delete-account",
		Summary:     "Delete account (GDPR)",
		Tags:        []string{"GDPR"},
	}, func(ctx context.Context, input *struct {
		Body DeleteAccountRequest
		handler.AuthContext
	}) (*struct{ Body map[string]string }, error) {
		if input.User.Email == "" {
			return nil, huma.Error401Unauthorized("Unauthorized")
		}

		if input.Body.ConfirmEmail != input.User.Email {
			return nil, huma.Error400BadRequest("Email confirmation mismatch")
		}

		deleteUser, err := svc.FindDeleteUserByEmail(ctx, input.User.Email)
		if err != nil {
			slog.Error("GDPR delete failed: failed to find user for deletion", "email", input.User.Email, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch user data for deletion")
		}

		err = svc.DeleteUserData(ctx, deleteUser.ID)
		if err != nil {
			slog.Error("GDPR delete failed: failed to delete user data", "userId", deleteUser.ID, "email", input.User.Email, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete account")
		}

		slog.Info("GDPR delete completed: user data deleted", "userId", deleteUser.ID, "email", input.User.Email)

		return &struct{ Body map[string]string }{Body: map[string]string{
			"status": "deleted",
			"email":  input.User.Email,
		}}, nil
	})
}
