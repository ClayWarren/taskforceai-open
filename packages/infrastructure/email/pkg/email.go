// Package email provides email sending capabilities.
package email

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

type EmailService interface {
	SendEmail(ctx context.Context, to, subject, htmlBody string) error
	SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error
	SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error
	SendPaymentConfirmationEmail(ctx context.Context, to, displayName, plan string, amount float64, currency string) error
	SendSubscriptionFailureEmail(ctx context.Context, to, displayName, plan, reason string) error
	SendIssueReportEmail(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error
}

// LogEmailService is a placeholder implementation that logs emails instead of sending them.
type LogEmailService struct {
	Logger *slog.Logger
}

func DefaultService() EmailService {
	if strings.TrimSpace(os.Getenv("RESEND_API_KEY")) != "" {
		return NewResendEmailService()
	}
	if isProductionRuntime() {
		return NewResendEmailService()
	}
	return &LogEmailService{Logger: slog.Default()}
}

func isProductionRuntime() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "production") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("VERCEL_ENV")), "production")
}

func (s *LogEmailService) SendEmail(ctx context.Context, to, subject, htmlBody string) error {
	s.Logger.Info("Sending Email", "to", to, "subject", subject)
	return nil
}

func (s *LogEmailService) SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error {
	s.Logger.Info("Sending API Key Created Email", "to", to, "keyName", keyName)
	return nil
}

func (s *LogEmailService) SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error {
	s.Logger.Info("Sending API Key Revoked Email", "to", to, "keyName", keyName)
	return nil
}

func (s *LogEmailService) SendPaymentConfirmationEmail(ctx context.Context, to, displayName, plan string, amount float64, currency string) error {
	s.Logger.Info("Sending Payment Confirmation Email", "to", to, "amount", amount)
	return nil
}

func (s *LogEmailService) SendSubscriptionFailureEmail(ctx context.Context, to, displayName, plan, reason string) error {
	s.Logger.Info("Sending Subscription Failure Email", "to", to, "reason", reason)
	return nil
}

func (s *LogEmailService) SendIssueReportEmail(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
	s.Logger.Info("Sending Issue Report Email", "to", to, "category", category, "displayName", displayName)
	return nil
}
