package postgres

import (
	"context"
	"reflect"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// DBMetrics records Postgres query latency and failures.
type DBMetrics struct {
	meter    metric.Meter
	duration metric.Float64Histogram
	total    metric.Int64Counter
	errors   metric.Int64Counter
}

var dbMetricsInstance *DBMetrics

// InitDBMetrics initializes the shared Postgres instruments.
func InitDBMetrics(serviceName string) *DBMetrics {
	meter := otel.Meter(serviceName + "-db")

	duration, _ := meter.Float64Histogram(
		"db.query.duration",
		metric.WithDescription("Duration of database queries in milliseconds"),
		metric.WithUnit("ms"),
	)
	total, _ := meter.Int64Counter(
		"db.query.total",
		metric.WithDescription("Total number of database queries"),
	)
	errors, _ := meter.Int64Counter(
		"db.query.error.total",
		metric.WithDescription("Total number of database query errors"),
	)

	dbMetricsInstance = &DBMetrics{
		meter:    meter,
		duration: duration,
		total:    total,
		errors:   errors,
	}
	return dbMetricsInstance
}

// RecordDBQuery records a database query execution.
func (m *DBMetrics) RecordDBQuery(
	ctx context.Context,
	operation string,
	table string,
	duration time.Duration,
	err error,
) {
	if m == nil {
		return
	}

	attrs := []attribute.KeyValue{
		attribute.String("db.operation", operation),
		attribute.String("db.table", table),
	}
	m.duration.Record(ctx, float64(duration.Milliseconds()), metric.WithAttributes(attrs...))
	m.total.Add(ctx, 1, metric.WithAttributes(attrs...))

	if err != nil {
		m.errors.Add(ctx, 1, metric.WithAttributes(
			attribute.String("db.operation", operation),
			attribute.String("db.table", table),
			attribute.String("db.error.class", reflect.TypeOf(err).String()),
		))
	}
}

// GetDBMetrics returns the initialized Postgres metrics instance.
func GetDBMetrics() *DBMetrics {
	return dbMetricsInstance
}
