package run

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/inngest/inngestgo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func resetRuntimeTelemetryForTest() {
	telemetryOnce = sync.Once{}
	telemetryInst = runtimeTelemetry{}
}

func setupTracerRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prev)
		resetRuntimeTelemetryForTest()
	})
	resetRuntimeTelemetryForTest()
	return recorder
}

func attrMap(attrs []attribute.KeyValue) map[attribute.Key]attribute.Value {
	out := make(map[attribute.Key]attribute.Value, len(attrs))
	for _, kv := range attrs {
		out[kv.Key] = kv.Value
	}
	return out
}

func TestFinishSubmissionObservation_AssignsSubmissionErrorCodes(t *testing.T) {
	recorder := setupTracerRecorder(t)

	req := TaskSubmissionRequest{
		UserID:  8,
		ModelID: "openai/gpt-5.6-sol",
		Source:  "api",
	}
	ctx, span := startSubmissionSpan(context.Background(), req)
	finishSubmissionObservation(ctx, span, time.Now().Add(-5*time.Millisecond), &TaskSubmissionError{
		Code: TaskSubmissionQueue,
		Err:  errors.New("queue unavailable"),
	})

	ended := recorder.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if ended[0].Status().Code != codes.Error {
		t.Fatalf("expected Error status, got %v", ended[0].Status().Code)
	}
	attrs := attrMap(ended[0].Attributes())
	if got := attrs["submission.error_code"].AsString(); got != string(TaskSubmissionQueue) {
		t.Fatalf("expected submission.error_code=%q, got %q", TaskSubmissionQueue, got)
	}
	if !attrs["submission.failed"].AsBool() {
		t.Fatal("expected submission.failed=true")
	}
}

func TestFinishSubmissionObservation_MapsUnknownErrorsToInternal(t *testing.T) {
	recorder := setupTracerRecorder(t)

	req := TaskSubmissionRequest{
		UserID:  8,
		ModelID: "openai/gpt-5.6-sol",
		Source:  "api",
	}
	ctx, span := startSubmissionSpan(context.Background(), req)
	finishSubmissionObservation(ctx, span, time.Now().Add(-5*time.Millisecond), errors.New("boom"))

	ended := recorder.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	attrs := attrMap(ended[0].Attributes())
	if got := attrs["submission.error_code"].AsString(); got != string(TaskSubmissionInternal) {
		t.Fatalf("expected submission.error_code=%q, got %q", TaskSubmissionInternal, got)
	}
}

func TestFinishSubmissionObservation_SetsSuccessStatus(t *testing.T) {
	recorder := setupTracerRecorder(t)
	ctx, span := startSubmissionSpan(context.Background(), TaskSubmissionRequest{UserID: 8, ModelID: "model"})

	finishSubmissionObservation(ctx, span, time.Now().Add(-time.Millisecond), nil)

	ended := recorder.Ended()
	require.Len(t, ended, 1)
	assert.Equal(t, codes.Ok, ended[0].Status().Code)
}

func TestFinishTaskObservation_NormalizesFailedStatusWithoutError(t *testing.T) {
	recorder := setupTracerRecorder(t)

	ctx, span := startTaskSpan(context.Background(), "task_456", 7, "openai/gpt-5.6-sol", OrchestrateTaskOptions{})
	finishTaskObservation(ctx, span, time.Now().Add(-10*time.Millisecond), StatusFailed, nil, OrchestrateTaskOptions{
		Source: "mobile",
	})

	ended := recorder.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if ended[0].Status().Code != codes.Error {
		t.Fatalf("expected Error span status, got %v", ended[0].Status().Code)
	}
	if ended[0].Status().Description != "task orchestration failed" {
		t.Fatalf("unexpected span status description: %q", ended[0].Status().Description)
	}
}

func TestFinishTaskObservation_SetsSuccessStatusAndAttributes(t *testing.T) {
	recorder := setupTracerRecorder(t)

	ctx, span := startTaskSpan(context.Background(), "task_123", 42, "openai/gpt-5.6-sol", OrchestrateTaskOptions{
		UserPlan:         "pro",
		QuickModeEnabled: true,
		Source:           "web",
	})

	finishTaskObservation(ctx, span, time.Now().Add(-10*time.Millisecond), StatusCompleted, nil, OrchestrateTaskOptions{
		UserPlan:         "pro",
		QuickModeEnabled: true,
		Source:           "web",
	})

	ended := recorder.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if ended[0].Status().Code != codes.Ok {
		t.Fatalf("expected OK span status, got %v", ended[0].Status().Code)
	}
	attrs := attrMap(ended[0].Attributes())
	if got := attrs["task.status"].AsString(); got != string(StatusCompleted) {
		t.Fatalf("expected task.status=%q, got %q", StatusCompleted, got)
	}
	if got := attrs["task.source"].AsString(); got != "web" {
		t.Fatalf("expected task.source=web, got %q", got)
	}
}

func TestGetRuntimeTelemetry_InitializesCountersAndHistograms(t *testing.T) {
	resetRuntimeTelemetryForTest()
	t.Cleanup(resetRuntimeTelemetryForTest)

	telemetry := getRuntimeTelemetry()
	if telemetry.taskDuration == nil || telemetry.taskTotal == nil || telemetry.taskFailed == nil {
		t.Fatal("expected task metrics to be initialized")
	}
	if telemetry.submissionDuration == nil || telemetry.submissionTotal == nil || telemetry.submissionFailed == nil {
		t.Fatal("expected submission metrics to be initialized")
	}
	if telemetry.pulseDuration == nil || telemetry.pulseTotal == nil || telemetry.pulseFailed == nil {
		t.Fatal("expected pulse metrics to be initialized")
	}
	if telemetry.generatedFileDuration == nil || telemetry.generatedFileTotal == nil || telemetry.generatedFileFailed == nil || telemetry.generatedFileBytes == nil {
		t.Fatal("expected generated file metrics to be initialized")
	}
}

func TestIsRedisKeyNotFoundErrorVariants(t *testing.T) {
	assert.False(t, isRedisKeyNotFoundError(nil))
	assert.True(t, isRedisKeyNotFoundError(errors.New("key not found")))
	assert.True(t, isRedisKeyNotFoundError(errors.New("redis: nil")))
	assert.False(t, isRedisKeyNotFoundError(errors.New("connection reset")))
}

func TestNewInngestClient_ConstructorErrorReturnsEmptyClient(t *testing.T) {
	original := newInngestClient
	t.Setenv("INNGEST_EVENT_KEY", "test-event-key")
	newInngestClient = func(opts inngestgo.ClientOpts) (InngestSender, error) {
		return nil, errors.New("client init failed")
	}
	t.Cleanup(func() { newInngestClient = original })

	client := NewInngestClient()
	_, err := client.Send(context.Background(), InngestEvent{Name: "task.execute"})
	require.Error(t, err)
}

func TestNewInngestClient_WithEventKey(t *testing.T) {
	original := newInngestClient
	t.Setenv("INNGEST_EVENT_KEY", "test-event-key")
	newInngestClient = func(opts inngestgo.ClientOpts) (InngestSender, error) {
		return &stubInngestSender{id: "evt-123"}, nil
	}
	t.Cleanup(func() { newInngestClient = original })

	client := NewInngestClient()
	require.NotNil(t, client)
	id, err := client.Send(context.Background(), InngestEvent{Name: "task.execute", Data: map[string]any{"taskId": "t1"}})
	require.NoError(t, err)
	assert.Equal(t, "evt-123", id)
}

func TestRecordCacheDecisionAndQueueLatencyNoPanic(t *testing.T) {
	recordCacheDecision(context.Background(), "hit")
	recordCacheDecision(context.Background(), "skipped_attachments")
	recordQueueLatency(context.Background(), 250*time.Millisecond)
}

func TestTelemetryNilMetricInstrumentsNoPanic(t *testing.T) {
	resetRuntimeTelemetryForTest()
	telemetryOnce.Do(func() {})
	t.Cleanup(resetRuntimeTelemetryForTest)

	ctx := context.Background()
	recordCacheDecision(ctx, "missing_counter")
	recordQueueLatency(ctx, time.Millisecond)
	finishGeneratedFileObservation(
		ctx,
		trace.SpanFromContext(ctx),
		time.Now().Add(-time.Millisecond),
		"create_site",
		"text/html",
		"SITE",
		12,
		"skipped",
		nil,
	)
}

func TestDefaultNewInngestClientBuilder(t *testing.T) {
	devMode := true
	client, err := newInngestClient(inngestgo.ClientOpts{
		AppID: "taskforceai-engine-test",
		Dev:   &devMode,
	})
	require.NoError(t, err)
	require.NotNil(t, client)
}

func TestNewInngestSDKClientBranches(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "")
	client, err := NewInngestSDKClient()
	require.ErrorIs(t, err, errInngestNotConfigured)
	require.Nil(t, client)

	t.Setenv("INNGEST_DEV", "1")
	client, err = NewInngestSDKClient()
	require.NoError(t, err)
	require.NotNil(t, client)
}

func TestFinishGeneratedFileObservation_SetsOutcomeAttributes(t *testing.T) {
	recorder := setupTracerRecorder(t)

	ctx, span := startGeneratedFileSpan(context.Background(), "create_site", "text/html", "SITE")
	finishGeneratedFileObservation(
		ctx,
		span,
		time.Now().Add(-5*time.Millisecond),
		"create_site",
		"text/html",
		"SITE",
		512,
		"persisted",
		nil,
	)

	ended := recorder.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(ended))
	}
	if ended[0].Status().Code != codes.Ok {
		t.Fatalf("expected OK span status, got %v", ended[0].Status().Code)
	}
	attrs := attrMap(ended[0].Attributes())
	if got := attrs["generated_file.outcome"].AsString(); got != "persisted" {
		t.Fatalf("expected generated_file.outcome=persisted, got %q", got)
	}
	if got := attrs["generated_file.tool"].AsString(); got != "create_site" {
		t.Fatalf("expected generated_file.tool=create_site, got %q", got)
	}
	if got := attrs["generated_file.bytes"].AsInt64(); got != 512 {
		t.Fatalf("expected generated_file.bytes=512, got %d", got)
	}
}

func TestFinishGeneratedFileObservation_RecordsFailure(t *testing.T) {
	recorder := setupTracerRecorder(t)
	ctx, span := startGeneratedFileSpan(context.Background(), "create_site", "text/html", "SITE")

	finishGeneratedFileObservation(
		ctx,
		span,
		time.Now().Add(-time.Millisecond),
		"create_site",
		"text/html",
		"SITE",
		12,
		"write_failed",
		errors.New("write failed"),
	)

	ended := recorder.Ended()
	require.Len(t, ended, 1)
	assert.Equal(t, codes.Error, ended[0].Status().Code)
}
