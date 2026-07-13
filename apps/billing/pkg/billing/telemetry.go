package billing

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

type billingTelemetry struct {
	tracer             trace.Tracer
	subscriptionActive metric.Int64UpDownCounter
	paymentTotal       metric.Int64Counter
	paymentFailed      metric.Int64Counter
	webhookTotal       metric.Int64Counter
	webhookFailed      metric.Int64Counter
}

var (
	telemetryOnce sync.Once
	telemetryInst billingTelemetry
)

func getTelemetry() billingTelemetry {
	telemetryOnce.Do(func() {
		meter := otel.Meter("billing-service")
		telemetryInst.tracer = otel.Tracer("billing-service.logic")

		telemetryInst.subscriptionActive, _ = meter.Int64UpDownCounter(
			"billing.subscription.active",
			metric.WithDescription("Number of active subscriptions"),
		)
		telemetryInst.paymentTotal, _ = meter.Int64Counter(
			"billing.payment.total",
			metric.WithDescription("Total number of payment attempts"),
		)
		telemetryInst.paymentFailed, _ = meter.Int64Counter(
			"billing.payment.failed",
			metric.WithDescription("Total number of failed payments"),
		)
		telemetryInst.webhookTotal, _ = meter.Int64Counter(
			"billing.webhook.total",
			metric.WithDescription("Total number of webhook events processed"),
		)
		telemetryInst.webhookFailed, _ = meter.Int64Counter(
			"billing.webhook.failed",
			metric.WithDescription("Total number of failed webhook processing"),
		)
	})
	return telemetryInst
}

func startSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return getTelemetry().tracer.Start(ctx, name, trace.WithAttributes(attrs...))
}

func recordSubscriptionChange(ctx context.Context, delta int64, plan string) {
	getTelemetry().subscriptionActive.Add(ctx, delta, metric.WithAttributes(
		attribute.String("plan", plan),
	))
}

func recordPayment(ctx context.Context, success bool, amount float64, currency string) {
	attrs := []attribute.KeyValue{
		attribute.String("currency", currency),
		attribute.Float64("amount", amount),
	}
	getTelemetry().paymentTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
	if !success {
		getTelemetry().paymentFailed.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
}

func recordStripeWebhook(ctx context.Context, success bool, eventType string) {
	attrs := []attribute.KeyValue{
		attribute.String("provider", "stripe"),
		attribute.String("event_type", eventType),
	}
	getTelemetry().webhookTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
	if !success {
		getTelemetry().webhookFailed.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
}
