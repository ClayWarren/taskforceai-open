package billing

import "context"

// newWebhookTest returns a WebhookService backed by a fresh mock repository plus
// a background context — the setup repeated by most webhook handler tests.
func newWebhookTest() (*WebhookService, *MockWebhookRepository, context.Context) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	return svc, mockRepo, context.Background()
}
