package realtime

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

type pollTelemetry struct {
	tracer       trace.Tracer
	duration     metric.Float64Histogram
	total        metric.Int64Counter
	failed       metric.Int64Counter
	messageCount metric.Int64Histogram
}

var (
	pollTelemetryOnce sync.Once
	pollTelemetryInst pollTelemetry
)

func getPollTelemetry() pollTelemetry {
	pollTelemetryOnce.Do(func() {
		meter := otel.Meter("sync-realtime")
		pollTelemetryInst.tracer = otel.Tracer("sync-realtime.poll")
		pollTelemetryInst.duration, _ = meter.Float64Histogram(
			"sync.realtime.poll.duration",
			metric.WithDescription("Duration of realtime sync poll requests in seconds"),
			metric.WithUnit("s"),
		)
		pollTelemetryInst.total, _ = meter.Int64Counter(
			"sync.realtime.poll.total",
			metric.WithDescription("Total number of realtime sync poll requests"),
		)
		pollTelemetryInst.failed, _ = meter.Int64Counter(
			"sync.realtime.poll.failed",
			metric.WithDescription("Realtime sync poll requests that failed or degraded"),
		)
		pollTelemetryInst.messageCount, _ = meter.Int64Histogram(
			"sync.realtime.poll.messages",
			metric.WithDescription("Number of realtime sync messages returned per poll"),
		)
	})
	return pollTelemetryInst
}

func startPollSpan(ctx context.Context, r *http.Request) (context.Context, trace.Span) {
	telemetry := getPollTelemetry()
	method := ""
	lastIDPresent := false
	if r != nil {
		method = r.Method
		if r.URL != nil {
			lastIDPresent = r.URL.Query().Get("last_id") != ""
		}
	}
	return telemetry.tracer.Start(ctx, "sync.realtime.poll", trace.WithAttributes(
		attribute.String("http.method", method),
		attribute.Bool("sync.realtime.last_id_present", lastIDPresent),
	))
}

func finishPollObservation(
	ctx context.Context,
	span trace.Span,
	startedAt time.Time,
	outcome string,
	scope string,
	messageCount int,
	err error,
) {
	telemetry := getPollTelemetry()
	attrs := []attribute.KeyValue{
		attribute.String("sync.realtime.outcome", outcome),
		attribute.String("sync.realtime.scope", scope),
	}

	if telemetry.duration != nil {
		telemetry.duration.Record(ctx, time.Since(startedAt).Seconds(), metric.WithAttributes(attrs...))
	}
	if telemetry.total != nil {
		telemetry.total.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
	if telemetry.messageCount != nil {
		telemetry.messageCount.Record(ctx, int64(messageCount), metric.WithAttributes(attrs...))
	}
	if pollOutcomeFailed(outcome, err) && telemetry.failed != nil {
		telemetry.failed.Add(ctx, 1, metric.WithAttributes(attrs...))
	}

	span.SetAttributes(attrs...)
	span.SetAttributes(attribute.Int("sync.realtime.message_count", messageCount))
	switch {
	case err != nil:
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	case pollOutcomeFailed(outcome, err):
		span.SetStatus(codes.Error, outcome)
	default:
		span.SetStatus(codes.Ok, "poll completed")
	}
	span.End()
}

func pollOutcomeFailed(outcome string, err error) bool {
	if err != nil {
		return true
	}
	switch outcome {
	case "success", "cors_preflight", "empty_missing_redis":
		return false
	default:
		return true
	}
}

func pollScope(orgID string) string {
	if orgID != "" {
		return "organization"
	}
	return "user"
}

var errPollPanic = errors.New("panic in sync realtime poll")
