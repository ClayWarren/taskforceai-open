package support

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/infrastructure/email/pkg"
)

// ReportRequest represents a support issue report.
type ReportRequest struct {
	Category    string         `json:"category" minLength:"1" doc:"Category of the issue"`
	Description string         `json:"description" minLength:"1" maxLength:"5000" doc:"Details"`
	Metadata    map[string]any `json:"metadata,omitempty" doc:"Optional metadata"`
}

// RegisterHandlers registers the support handlers.
func RegisterHandlers(api huma.API, emailService email.EmailService) {
	huma.Register(api, huma.Operation{
		OperationID: "report-issue",
		Method:      http.MethodPost,
		Path:        "/api/v1/support/report",
		Summary:     "Report an issue",
		Tags:        []string{"Support"},
	}, func(ctx context.Context, input *struct {
		Body ReportRequest
		handler.OptionalAuthContext
	}) (*struct{ Body map[string]string }, error) {
		identifier := "anonymous"
		if input.User != nil {
			identifier = input.User.Email
			if input.User.FullName != nil {
				identifier = fmt.Sprintf("%s (%s)", *input.User.FullName, input.User.Email)
			}
		}

		supportEmail := os.Getenv("TASKFORCEAI_SUPPORT_INBOX")
		if supportEmail == "" {
			supportEmail = "support@taskforceai.chat"
		}

		err := emailService.SendIssueReportEmail(ctx, supportEmail, input.Body.Category, input.Body.Description, identifier, input.Body.Metadata)
		if err != nil {
			slog.Error("Failed to send support email", "category", input.Body.Category, "authenticated", input.User != nil, "error", err)
			return nil, huma.Error500InternalServerError("Failed to submit report")
		}
		slog.Info("Support report submitted", "category", input.Body.Category, "authenticated", input.User != nil, "hasMetadata", len(input.Body.Metadata) > 0)

		return &struct{ Body map[string]string }{Body: map[string]string{"message": "Report submitted successfully"}}, nil
	})
}
