package postgres

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type metricsContextKey struct{}

// MetricsTracer implements pgx.QueryTracer to record OTel metrics and spans.
type MetricsTracer struct {
	tracer trace.Tracer
}

func NewMetricsTracer() *MetricsTracer {
	return &MetricsTracer{
		tracer: otel.Tracer("github.com/TaskForceAI/infrastructure/postgres/pkg"),
	}
}

type traceData struct {
	startTime time.Time
	operation string
	span      trace.Span
}

func (t *MetricsTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	operation := "query"
	sql := strings.ToUpper(strings.TrimSpace(data.SQL))
	if len(sql) > 6 {
		firstWord := sql[:6]
		switch {
		case strings.HasPrefix(firstWord, "SELECT"):
			operation = "select"
		case strings.HasPrefix(firstWord, "INSERT"):
			operation = "insert"
		case strings.HasPrefix(firstWord, "UPDATE"):
			operation = "update"
		case strings.HasPrefix(firstWord, "DELETE"):
			operation = "delete"
		}
	}

	// Start OTel span
	ctx, span := t.tracer.Start(ctx, "db."+operation,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("db.system", "postgresql"),
			attribute.String("db.operation", operation),
			attribute.String("db.statement", data.SQL),
		),
	)

	return context.WithValue(ctx, metricsContextKey{}, &traceData{
		startTime: time.Now(),
		operation: operation,
		span:      span,
	})
}

func (t *MetricsTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	td, ok := ctx.Value(metricsContextKey{}).(*traceData)
	if !ok {
		return
	}

	defer td.span.End()

	duration := time.Since(td.startTime)
	metrics := GetDBMetrics()
	if metrics != nil {
		metrics.RecordDBQuery(ctx, td.operation, "unknown", duration, data.Err)
	}

	if data.Err != nil {
		td.span.RecordError(data.Err)
		td.span.SetStatus(codes.Error, data.Err.Error())
	} else {
		td.span.SetStatus(codes.Ok, "")
	}
}
