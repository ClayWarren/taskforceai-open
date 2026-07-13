package email

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/resend/resend-go/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeResendEmailSender struct {
	err     error
	request *resend.SendEmailRequest
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func (f *fakeResendEmailSender) SendWithContext(_ context.Context, params *resend.SendEmailRequest) (*resend.SendEmailResponse, error) {
	f.request = params
	return &resend.SendEmailResponse{Id: "email_123"}, f.err
}

func TestLogEmailService_SendEmail(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	err := svc.SendEmail(context.Background(), "test@example.com", "Test Subject", "<p>Test Body</p>")

	assert.NoError(t, err)
}

func TestLogEmailService_SendApiKeyCreatedEmail(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	err := svc.SendApiKeyCreatedEmail(context.Background(), "test@example.com", "John Doe", "Production Key", "tfai_abc")

	assert.NoError(t, err)
}

func TestLogEmailService_SendApiKeyRevokedEmail(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	err := svc.SendApiKeyRevokedEmail(context.Background(), "test@example.com", "John Doe", "Production Key")

	assert.NoError(t, err)
}

func TestLogEmailService_SendPaymentConfirmationEmail(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	err := svc.SendPaymentConfirmationEmail(context.Background(), "test@example.com", "John Doe", "pro", 29.99, "USD")

	assert.NoError(t, err)
}

func TestLogEmailService_SendSubscriptionFailureEmail(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	err := svc.SendSubscriptionFailureEmail(context.Background(), "test@example.com", "John Doe", "pro", "Card declined")

	assert.NoError(t, err)
}

func TestLogEmailService_SendIssueReportEmail(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	metadata := map[string]any{
		"browser": "Chrome",
		"os":      "macOS",
	}

	err := svc.SendIssueReportEmail(context.Background(), "support@example.com", "Bug Report", "App crashes on login", "John Doe", metadata)

	assert.NoError(t, err)
}

func TestEmailService_Interface(t *testing.T) {
	// Verify LogEmailService implements EmailService
	var _ EmailService = (*LogEmailService)(nil)
}

func TestLogEmailService_NilMetadata(t *testing.T) {
	logger := slog.Default()
	svc := &LogEmailService{Logger: logger}

	err := svc.SendIssueReportEmail(context.Background(), "support@example.com", "Bug Report", "Description", "User", nil)

	assert.NoError(t, err)
}

func TestDefaultServiceUsesLogEmailServiceWithoutResendKey(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "   ")
	t.Setenv("NODE_ENV", "development")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")

	svc := DefaultService()

	assert.IsType(t, &LogEmailService{}, svc)
}

func TestDefaultServiceFailsClosedWithoutResendKeyInProduction(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("NODE_ENV", "production")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")

	svc := DefaultService()
	assert.IsType(t, &ResendEmailService{}, svc)
	require.ErrorContains(
		t,
		svc.SendEmail(context.Background(), "to@example.com", "Subject", "<p>Body</p>"),
		"RESEND_API_KEY not set",
	)
}

func TestDefaultServiceUsesResendWhenConfigured(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key")
	t.Setenv("RESEND_FROM_EMAIL", "from@example.com")

	svc := DefaultService()

	resendSvc, ok := svc.(*ResendEmailService)
	require.True(t, ok)
	assert.NotNil(t, resendSvc.client)
	assert.Equal(t, "from@example.com", resendSvc.fromEmail)
}

// ResendEmailService tests

func TestNewResendEmailService_NoApiKey(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("RESEND_FROM_EMAIL", "")

	svc := NewResendEmailService()

	assert.Nil(t, svc.client)
	assert.Equal(t, "onboarding@resend.dev", svc.fromEmail)
}

func TestNewResendEmailService_WithFromEmail(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("RESEND_FROM_EMAIL", "custom@example.com")

	svc := NewResendEmailService()

	assert.Equal(t, "custom@example.com", svc.fromEmail)
}

func TestResendEmailService_SendEmail_NoClient(t *testing.T) {
	svc := &ResendEmailService{
		client:    nil,
		fromEmail: "test@example.com",
	}

	err := svc.SendEmail(context.Background(), "to@example.com", "Subject", "<p>Body</p>")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "RESEND_API_KEY not set")
}

func TestResendEmailService_SendEmail_UsesSender(t *testing.T) {
	sender := &fakeResendEmailSender{}
	svc := &ResendEmailService{
		emails:    sender,
		fromEmail: "from@example.com",
	}

	err := svc.SendEmail(context.Background(), "to@example.com", "Subject", "<p>Body</p>")

	require.NoError(t, err)
	require.NotNil(t, sender.request)
	assert.Equal(t, "from@example.com", sender.request.From)
	assert.Equal(t, []string{"to@example.com"}, sender.request.To)
	assert.Equal(t, "Subject", sender.request.Subject)
	assert.Equal(t, "<p>Body</p>", sender.request.Html)
}

func TestResendEmailService_SendEmail_SenderError(t *testing.T) {
	svc := &ResendEmailService{
		emails:    &fakeResendEmailSender{err: errors.New("send failed")},
		fromEmail: "from@example.com",
	}

	err := svc.SendEmail(context.Background(), "to@example.com", "Subject", "<p>Body</p>")

	require.ErrorContains(t, err, "send failed")
}

func TestResendEmailService_SendEmail_FallsBackToClientEmails(t *testing.T) {
	client := resend.NewCustomClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"id":"email_123"}`)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Request:    r,
		}, nil
	})}, "test-key")
	svc := &ResendEmailService{
		client:    client,
		fromEmail: "from@example.com",
	}

	err := svc.SendEmail(context.Background(), "to@example.com", "Subject", "<p>Body</p>")

	require.NoError(t, err)
}

func TestResendEmailService_SendEmail_NilClientEmailsReturnsError(t *testing.T) {
	svc := &ResendEmailService{
		client:    &resend.Client{},
		fromEmail: "from@example.com",
	}

	err := svc.SendEmail(context.Background(), "to@example.com", "Subject", "<p>Body</p>")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "RESEND_API_KEY not set")
}

func TestResendEmailService_SendApiKeyCreatedEmail_NoClient(t *testing.T) {
	svc := &ResendEmailService{client: nil}

	err := svc.SendApiKeyCreatedEmail(context.Background(), "to@example.com", "John", "Key1", "tfai_")

	assert.Error(t, err)
}

func TestResendEmailService_SendApiKeyRevokedEmail_NoClient(t *testing.T) {
	svc := &ResendEmailService{client: nil}

	err := svc.SendApiKeyRevokedEmail(context.Background(), "to@example.com", "John", "Key1")

	assert.Error(t, err)
}

func TestResendEmailService_SendPaymentConfirmationEmail_NoClient(t *testing.T) {
	svc := &ResendEmailService{client: nil}

	err := svc.SendPaymentConfirmationEmail(context.Background(), "to@example.com", "John", "pro", 29.99, "USD")

	assert.Error(t, err)
}

func TestResendEmailService_SendSubscriptionFailureEmail_NoClient(t *testing.T) {
	svc := &ResendEmailService{client: nil}

	err := svc.SendSubscriptionFailureEmail(context.Background(), "to@example.com", "John", "pro", "Card declined")

	assert.Error(t, err)
}

func TestResendEmailService_SendIssueReportEmail_NoClient(t *testing.T) {
	svc := &ResendEmailService{client: nil}

	err := svc.SendIssueReportEmail(context.Background(), "to@example.com", "Bug", "Description", "John", nil)

	assert.Error(t, err)
}

func TestResendEmailService_SendIssueReportEmail_WithMetadata_NoClient(t *testing.T) {
	svc := &ResendEmailService{client: nil}

	metadata := map[string]any{"key": "value", "number": 123}
	err := svc.SendIssueReportEmail(context.Background(), "to@example.com", "Bug", "Description", "John", metadata)

	assert.Error(t, err)
}

func TestResendEmailService_Interface(t *testing.T) {
	// Verify ResendEmailService implements EmailService
	var _ EmailService = (*ResendEmailService)(nil)
}

func TestRenderAPIKeyCreatedEmailHTML_EscapesUserInput(t *testing.T) {
	html := renderAPIKeyCreatedEmailHTML(
		`<script>alert("x")</script>`,
		`Key <b>prod</b>`,
		`tfai_<bad>`,
	)

	assert.NotContains(t, html, "<script>")
	assert.NotContains(t, html, "<b>prod</b>")
	assert.NotContains(t, html, "tfai_<bad>")
	assert.Contains(t, html, "&lt;script&gt;alert(&#34;x&#34;)&lt;/script&gt;")
	assert.Contains(t, html, "Key &lt;b&gt;prod&lt;/b&gt;")
	assert.Contains(t, html, "tfai_&lt;bad&gt;")
}

func TestRenderPaymentAndFailureEmailHTML_EscapeUserInput(t *testing.T) {
	paymentHTML := renderPaymentConfirmationEmailHTML(
		`<img src=x onerror=alert(1)>`,
		`pro <strong>annual</strong>`,
		29.99,
		`USD<script>`,
	)
	failureHTML := renderSubscriptionFailureEmailHTML(
		`<script>alert(1)</script>`,
		`team <b>plan</b>`,
		`card declined <img src=x onerror=alert(1)>`,
	)

	for _, html := range []string{paymentHTML, failureHTML} {
		assert.NotContains(t, html, "<script>")
		assert.NotContains(t, html, "<img")
		assert.NotContains(t, html, "<b>plan</b>")
	}
	assert.Contains(t, paymentHTML, "pro &lt;strong&gt;annual&lt;/strong&gt;")
	assert.Contains(t, paymentHTML, "USD&lt;script&gt;")
	assert.Contains(t, failureHTML, "card declined &lt;img src=x onerror=alert(1)&gt;")
}

func TestRenderIssueReportEmailHTML_EscapesMetadata(t *testing.T) {
	html := renderIssueReportEmailHTML(
		`Bug <script>alert(1)</script>`,
		`Description <img src=x onerror=alert(1)>`,
		`Reporter <b>Name</b>`,
		map[string]any{
			"payload": `<img src=x onerror=alert(1)>`,
		},
	)

	assert.NotContains(t, html, "<script>")
	assert.NotContains(t, html, "<img")
	assert.NotContains(t, html, "<b>Name</b>")
	assert.Contains(t, html, "Bug &lt;script&gt;alert(1)&lt;/script&gt;")
	assert.Contains(t, html, "Description &lt;img src=x onerror=alert(1)&gt;")
	assert.Contains(t, html, "Reporter &lt;b&gt;Name&lt;/b&gt;")
	assert.Contains(t, html, "&lt;img src=x onerror=alert(1)&gt;")
	assert.True(t, strings.Contains(html, "<pre>") && strings.Contains(html, "</pre>"))
}
