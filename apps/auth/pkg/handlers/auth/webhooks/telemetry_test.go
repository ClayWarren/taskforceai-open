package webhooks

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func resetWorkOSWebhookTelemetryForTest() {
	workOSWebhookTelemetryOnce = sync.Once{}
	workOSWebhookTelemetryInst = workOSWebhookTelemetry{}
}

func setupWorkOSWebhookTracerRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prev)
		resetWorkOSWebhookTelemetryForTest()
	})
	resetWorkOSWebhookTelemetryForTest()
	return recorder
}

func workOSAttrMap(attrs []attribute.KeyValue) map[attribute.Key]attribute.Value {
	out := make(map[attribute.Key]attribute.Value, len(attrs))
	for _, kv := range attrs {
		out[kv.Key] = kv.Value
	}
	return out
}

func TestWorkOSWebhookTelemetryRecordsOutcomeAttributes(t *testing.T) {
	recorder := setupWorkOSWebhookTracerRecorder(t)
	req := httptest.NewRequest(http.MethodPost, "/", nil)

	ctx, span := startWorkOSWebhookSpan(context.Background(), req)
	finishWorkOSWebhookObservation(ctx, span, time.Now().Add(-5*time.Millisecond), "dsync.user.created", "processed", nil)

	_, failedSpan := startWorkOSWebhookSpan(context.Background(), req)
	finishWorkOSWebhookObservation(context.Background(), failedSpan, time.Now().Add(-5*time.Millisecond), "dsync.user.created", "membership_add_failed", errors.New("db unavailable"))

	ended := recorder.Ended()
	require.Len(t, ended, 2)
	assert.Equal(t, codes.Ok, ended[0].Status().Code)
	assert.Equal(t, codes.Error, ended[1].Status().Code)

	attrs := workOSAttrMap(ended[0].Attributes())
	assert.Equal(t, "dsync.user.created", attrs["workos.event_type"].AsString())
	assert.Equal(t, "processed", attrs["workos.outcome"].AsString())
}
