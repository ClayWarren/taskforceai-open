package webhooks

import (
	"context"
	"net/http"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

type workOSWebhookTelemetry struct {
	tracer     trace.Tracer
	duration   metric.Float64Histogram
	total      metric.Int64Counter
	failed     metric.Int64Counter
	deadLetter metric.Int64Counter
}

var (
	workOSWebhookTelemetryOnce sync.Once
	workOSWebhookTelemetryInst workOSWebhookTelemetry
)

func getWorkOSWebhookTelemetry() workOSWebhookTelemetry {
	workOSWebhookTelemetryOnce.Do(func() {
		meter := otel.Meter("auth-workos-webhook")
		workOSWebhookTelemetryInst.tracer = otel.Tracer("auth-workos-webhook")
		workOSWebhookTelemetryInst.duration, _ = meter.Float64Histogram(
			"auth.workos_webhook.duration",
			metric.WithDescription("Duration of WorkOS webhook handling in seconds"),
			metric.WithUnit("s"),
		)
		workOSWebhookTelemetryInst.total, _ = meter.Int64Counter(
			"auth.workos_webhook.total",
			metric.WithDescription("Total number of WorkOS webhooks handled"),
		)
		workOSWebhookTelemetryInst.failed, _ = meter.Int64Counter(
			"auth.workos_webhook.failed",
			metric.WithDescription("WorkOS webhook requests that failed"),
		)
		workOSWebhookTelemetryInst.deadLetter, _ = meter.Int64Counter(
			"auth.workos_webhook.dead_letter.total",
			metric.WithDescription("WorkOS webhook events written to the dead-letter store"),
		)
	})
	return workOSWebhookTelemetryInst
}

func startWorkOSWebhookSpan(ctx context.Context, r *http.Request) (context.Context, trace.Span) {
	telemetry := getWorkOSWebhookTelemetry()
	method := ""
	if r != nil {
		method = r.Method
	}
	return telemetry.tracer.Start(ctx, "auth.workos_webhook", trace.WithAttributes(
		attribute.String("http.method", method),
	))
}

func finishWorkOSWebhookObservation(
	ctx context.Context,
	span trace.Span,
	startedAt time.Time,
	eventType string,
	outcome string,
	err error,
) {
	telemetry := getWorkOSWebhookTelemetry()
	attrs := []attribute.KeyValue{
		attribute.String("workos.event_type", normalizedWorkOSEventType(eventType)),
		attribute.String("workos.outcome", outcome),
	}

	if telemetry.duration != nil {
		telemetry.duration.Record(ctx, time.Since(startedAt).Seconds(), metric.WithAttributes(attrs...))
	}
	if telemetry.total != nil {
		telemetry.total.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
	if workOSWebhookOutcomeFailed(outcome, err) && telemetry.failed != nil {
		telemetry.failed.Add(ctx, 1, metric.WithAttributes(attrs...))
	}

	span.SetAttributes(attrs...)
	switch {
	case err != nil:
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	case workOSWebhookOutcomeFailed(outcome, err):
		span.SetStatus(codes.Error, outcome)
	default:
		span.SetStatus(codes.Ok, "webhook handled")
	}
	span.End()
}

func recordWorkOSWebhookDeadLetter(ctx context.Context, eventType, reason string) {
	telemetry := getWorkOSWebhookTelemetry()
	if telemetry.deadLetter == nil {
		return
	}
	telemetry.deadLetter.Add(ctx, 1, metric.WithAttributes(
		attribute.String("workos.event_type", normalizedWorkOSEventType(eventType)),
		attribute.String("workos.dead_letter_reason", reason),
	))
}

func normalizedWorkOSEventType(eventType string) string {
	if eventType == "" {
		return "unknown"
	}
	return eventType
}

func workOSWebhookOutcomeFailed(outcome string, err error) bool {
	if err != nil {
		return true
	}
	switch outcome {
	case "processed", "duplicate", "ignored_unsupported_event":
		return false
	default:
		return true
	}
}
