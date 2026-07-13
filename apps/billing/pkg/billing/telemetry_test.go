package billing

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/stretchr/testify/assert"
)

func TestGetTelemetry(t *testing.T) {
	tel := getTelemetry()
	assert.NotNil(t, tel.tracer)
	assert.NotNil(t, tel.subscriptionActive)
	assert.NotNil(t, tel.paymentTotal)
	assert.NotNil(t, tel.paymentFailed)
	assert.NotNil(t, tel.webhookTotal)
	assert.NotNil(t, tel.webhookFailed)

	// Second call should return same instance (singleton)
	tel2 := getTelemetry()
	assert.Equal(t, tel, tel2)
}

func TestStartSpan(t *testing.T) {
	ctx, span := startSpan(context.Background(), "test-span")
	assert.NotNil(t, ctx)
	assert.NotNil(t, span)
	span.End()
}

func TestFinishSpan(t *testing.T) {
	_, span := startSpan(context.Background(), "test-span")
	observability.FinishSpan(span, nil)

	_, spanErr := startSpan(context.Background(), "test-span-err")
	observability.FinishSpan(spanErr, errors.New("test error"))
}

func TestRecordMethods(t *testing.T) {
	ctx := context.Background()

	// These shouldn't panic
	recordSubscriptionChange(ctx, 1, "pro")
	recordPayment(ctx, true, 29.99, "USD")
	recordPayment(ctx, false, 29.99, "USD")
	recordStripeWebhook(ctx, true, "invoice.paid")
	recordStripeWebhook(ctx, false, "invoice.failed")
}
