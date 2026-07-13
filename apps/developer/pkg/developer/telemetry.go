package developer

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

type devTelemetry struct {
	tracer    trace.Tracer
	keysTotal metric.Int64Counter
	keyRevoke metric.Int64Counter
}

var (
	telemetryOnce sync.Once
	telemetryInst devTelemetry
)

func getTelemetry() devTelemetry {
	telemetryOnce.Do(func() {
		meter := otel.Meter("developer-service")
		telemetryInst.tracer = otel.Tracer("developer-service.logic")

		telemetryInst.keysTotal, _ = meter.Int64Counter(
			"developer.keys.total",
			metric.WithDescription("Total number of API keys created"),
		)
		telemetryInst.keyRevoke, _ = meter.Int64Counter(
			"developer.keys.revoked",
			metric.WithDescription("Total number of API keys revoked"),
		)
	})
	return telemetryInst
}

func recordKeyCreation(ctx context.Context, tier string) {
	getTelemetry().keysTotal.Add(ctx, 1, metric.WithAttributes(
		attribute.String("tier", tier),
	))
}

func recordKeyRevocation(ctx context.Context) {
	getTelemetry().keyRevoke.Add(ctx, 1)
}
