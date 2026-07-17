package support

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
	"github.com/TaskForceAI/go-core/internal/handlertest"
	"github.com/TaskForceAI/infrastructure/email/pkg"
)

type mockEmailService struct {
	email.EmailService
	issueFunc func(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error
}

func (m *mockEmailService) SendEmail(ctx context.Context, to, subject, htmlBody string) error {
	return nil
}

func (m *mockEmailService) SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error {
	return nil
}

func (m *mockEmailService) SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error {
	return nil
}

func (m *mockEmailService) SendPaymentConfirmationEmail(ctx context.Context, to, displayName, plan string, amount float64, currency string) error {
	return nil
}

func (m *mockEmailService) SendSubscriptionFailureEmail(ctx context.Context, to, displayName, plan, reason string) error {
	return nil
}

func (m *mockEmailService) SendIssueReportEmail(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
	if m.issueFunc != nil {
		return m.issueFunc(ctx, to, category, description, displayName, metadata)
	}
	return nil
}

func setupSupportRouter(service email.EmailService, user *auth.AuthenticatedUser) *chi.Mux {
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

func TestReportIssue_SuccessWithUser(t *testing.T) {
	t.Setenv("TASKFORCEAI_SUPPORT_INBOX", "help@example.com")

	fullName := "Jane Doe"
	user := &auth.AuthenticatedUser{ID: 1, Email: "jane@example.com", FullName: &fullName}
	service := &mockEmailService{
		issueFunc: func(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
			if to != "help@example.com" {
				return errors.New("wrong inbox")
			}
			if displayName != "Jane Doe (jane@example.com)" {
				return errors.New("wrong identifier")
			}
			return nil
		},
	}

	router := setupSupportRouter(service, user)
	body := `{"category":"billing","description":"help"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/support/report", strings.NewReader(body))
}

func TestReportIssue_Anonymous(t *testing.T) {
	service := &mockEmailService{
		issueFunc: func(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
			if displayName != "anonymous" {
				return errors.New("expected anonymous")
			}
			return nil
		},
	}

	router := setupSupportRouter(service, nil)
	body := `{"category":"billing","description":"help"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/support/report", strings.NewReader(body))
}

func TestReportIssue_ServiceError(t *testing.T) {
	service := &mockEmailService{
		issueFunc: func(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
			return errors.New("send failed")
		},
	}

	router := setupSupportRouter(service, nil)
	body := `{"category":"billing","description":"help"}`
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/support/report", strings.NewReader(body))
}
