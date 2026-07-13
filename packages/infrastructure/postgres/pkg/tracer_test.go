package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestMetricsTracerRecordsQueryLifecycle(t *testing.T) {
	tracer := NewMetricsTracer()

	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "select 1"})
	if ctx.Value(metricsContextKey{}) == nil {
		t.Fatal("expected trace data in context")
	}

	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})

	InitDBMetrics("tracer-test")
	ctx = tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "select 2"})
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})
}

func TestMetricsTracerHandlesErrorsAndMissingStart(t *testing.T) {
	tracer := NewMetricsTracer()

	tracer.TraceQueryEnd(context.Background(), nil, pgx.TraceQueryEndData{Err: errors.New("db down")})

	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "insert into test values (1)"})
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: errors.New("insert failed")})
}

func TestMetricsTracerClassifiesWriteOperations(t *testing.T) {
	tracer := NewMetricsTracer()

	for _, sql := range []string{
		"update users set name = 'x'",
		"delete from users",
	} {
		ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: sql})
		td, ok := ctx.Value(metricsContextKey{}).(*traceData)
		if !ok {
			t.Fatalf("expected trace data for %q", sql)
		}
		if td.operation == "query" {
			t.Fatalf("expected classified operation for %q", sql)
		}
		tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})
	}
}
