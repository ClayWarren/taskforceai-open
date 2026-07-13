package email

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"os"

	"github.com/resend/resend-go/v3"
)

type ResendEmailService struct {
	client    *resend.Client
	emails    resendEmailSender
	fromEmail string
}

type resendEmailSender interface {
	SendWithContext(ctx context.Context, params *resend.SendEmailRequest) (*resend.SendEmailResponse, error)
}

func NewResendEmailService() *ResendEmailService {
	apiKey := os.Getenv("RESEND_API_KEY")
	fromEmail := os.Getenv("RESEND_FROM_EMAIL")
	if fromEmail == "" {
		fromEmail = "onboarding@resend.dev"
	}

	var client *resend.Client
	var emails resendEmailSender
	if apiKey != "" {
		client = resend.NewClient(apiKey)
		emails = client.Emails
	}

	return &ResendEmailService{
		client:    client,
		emails:    emails,
		fromEmail: fromEmail,
	}
}

func (s *ResendEmailService) SendEmail(ctx context.Context, to, subject, htmlBody string) error {
	sender := s.emails
	if sender == nil && s.client != nil && s.client.Emails != nil {
		sender = s.client.Emails
	}
	if sender == nil {
		return fmt.Errorf("RESEND_API_KEY not set")
	}

	params := &resend.SendEmailRequest{
		From:    s.fromEmail,
		To:      []string{to},
		Subject: subject,
		Html:    htmlBody,
	}

	_, err := sender.SendWithContext(ctx, params)
	return err
}

func (s *ResendEmailService) SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error {
	subject := "New API Key Created"
	html := renderAPIKeyCreatedEmailHTML(displayName, keyName, prefix)

	return s.SendEmail(ctx, to, subject, html)
}

func renderAPIKeyCreatedEmailHTML(displayName, keyName, prefix string) string {
	return fmt.Sprintf(`
		<h1>New API Key Created</h1>
		<p>Hi %s,</p>
		<p>A new API key <strong>%s</strong> (prefix: %s) has been created for your account.</p>
		<p>If you did not perform this action, please secure your account immediately.</p>
	`, escapeHTML(displayName), escapeHTML(keyName), escapeHTML(prefix))
}

func (s *ResendEmailService) SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error {
	subject := "API Key Revoked"
	html := renderAPIKeyRevokedEmailHTML(displayName, keyName)

	return s.SendEmail(ctx, to, subject, html)
}

func renderAPIKeyRevokedEmailHTML(displayName, keyName string) string {
	return fmt.Sprintf(`
		<h1>API Key Revoked</h1>
		<p>Hi %s,</p>
		<p>The API key <strong>%s</strong> has been revoked and can no longer be used.</p>
	`, escapeHTML(displayName), escapeHTML(keyName))
}

func (s *ResendEmailService) SendPaymentConfirmationEmail(ctx context.Context, to, displayName, plan string, amount float64, currency string) error {
	subject := "Payment Confirmation"
	html := renderPaymentConfirmationEmailHTML(displayName, plan, amount, currency)

	return s.SendEmail(ctx, to, subject, html)
}

func renderPaymentConfirmationEmailHTML(displayName, plan string, amount float64, currency string) string {
	return fmt.Sprintf(`
		<h1>Thank you for your payment!</h1>
		<p>Hi %s,</p>
		<p>Your payment of %.2f %s for the %s plan has been confirmed.</p>
		<p>Your subscription is now active.</p>
	`, escapeHTML(displayName), amount, escapeHTML(currency), escapeHTML(plan))
}

func (s *ResendEmailService) SendSubscriptionFailureEmail(ctx context.Context, to, displayName, plan, reason string) error {
	subject := "Subscription Update Failed"
	html := renderSubscriptionFailureEmailHTML(displayName, plan, reason)

	return s.SendEmail(ctx, to, subject, html)
}

func renderSubscriptionFailureEmailHTML(displayName, plan, reason string) string {
	return fmt.Sprintf(`
		<h1>Subscription Issue</h1>
		<p>Hi %s,</p>
		<p>We encountered an issue updating your %s plan subscription.</p>
		<p>Reason: %s</p>
		<p>Please check your payment method or contact support.</p>
	`, escapeHTML(displayName), escapeHTML(plan), escapeHTML(reason))
}

func (s *ResendEmailService) SendIssueReportEmail(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
	subject := fmt.Sprintf("Issue Report: %s", category)
	html := renderIssueReportEmailHTML(category, description, displayName, metadata)

	return s.SendEmail(ctx, to, subject, html)
}

func renderIssueReportEmailHTML(category, description, displayName string, metadata map[string]any) string {
	metaStr := ""
	if len(metadata) > 0 {
		metaJSON, err := json.MarshalIndent(metadata, "", "  ")
		if err == nil {
			metaStr = fmt.Sprintf("<pre>%s</pre>", escapeHTML(string(metaJSON)))
		}
	}

	return fmt.Sprintf(`
		<h1>Issue Report</h1>
		<p><strong>Reporter:</strong> %s</p>
		<p><strong>Category:</strong> %s</p>
		<p><strong>Description:</strong></p>
		<p>%s</p>
		<h3>Metadata:</h3>
		%s
	`, escapeHTML(displayName), escapeHTML(category), escapeHTML(description), metaStr)
}

func escapeHTML(value string) string {
	return template.HTMLEscapeString(value)
}
