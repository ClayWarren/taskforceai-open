package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/metric/noop"
)

func TestDBMetricsLifecycle(t *testing.T) {
	metrics := InitDBMetrics("test-service")
	require.NotNil(t, metrics)
	assert.Same(t, metrics, GetDBMetrics())

	metrics.RecordDBQuery(context.Background(), "SELECT", "users", time.Millisecond, nil)
	metrics.RecordDBQuery(
		context.Background(),
		"SELECT",
		"users",
		time.Millisecond,
		errors.New("boom"),
	)

	var nilMetrics *DBMetrics
	nilMetrics.RecordDBQuery(context.Background(), "SELECT", "users", time.Millisecond, nil)
}

func TestRecordDBQueryWithNoopInstruments(t *testing.T) {
	meter := noop.NewMeterProvider().Meter("test")
	duration, err := meter.Float64Histogram("db.query.duration")
	require.NoError(t, err)
	total, err := meter.Int64Counter("db.query.total")
	require.NoError(t, err)
	errorTotal, err := meter.Int64Counter("db.query.error.total")
	require.NoError(t, err)

	metrics := &DBMetrics{
		duration: duration,
		total:    total,
		errors:   errorTotal,
	}
	metrics.RecordDBQuery(
		context.Background(),
		"INSERT",
		"messages",
		time.Millisecond,
		errors.New("boom"),
	)
}
