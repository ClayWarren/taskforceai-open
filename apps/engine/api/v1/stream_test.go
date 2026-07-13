package stream

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/go-engine/pkg/run"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type streamUnsupportedJSON struct {
	Value chan int `json:"value"`
}

type failOnKeepAliveWriter struct {
	*httptest.ResponseRecorder
	writeCount int
}

func (w *failOnKeepAliveWriter) Write(p []byte) (int, error) {
	w.writeCount++
	if bytes.Contains(p, []byte(`"reason":"keep-alive"`)) {
		return 0, errors.New("write failed")
	}
	return w.ResponseRecorder.Write(p)
}

func (w *failOnKeepAliveWriter) Flush() error {
	return nil
}

type flushFailResponseWriter struct {
	*httptest.ResponseRecorder
}

func (w *flushFailResponseWriter) Flush() error {
	return errors.New("flush failed")
}

type writeFailResponseWriter struct {
	httptest.ResponseRecorder
}

func (w *writeFailResponseWriter) Write(p []byte) (int, error) {
	return 0, errors.New("write failed")
}

func (w *writeFailResponseWriter) Flush() error {
	return nil
}

type writeAfterPrefixFailResponseWriter struct {
	httptest.ResponseRecorder
	writeCount int
}

func (w *writeAfterPrefixFailResponseWriter) Write(p []byte) (int, error) {
	w.writeCount++
	if w.writeCount == 2 {
		return 0, errors.New("write failed")
	}
	return w.ResponseRecorder.Write(p)
}

func (w *writeAfterPrefixFailResponseWriter) Flush() error {
	return nil
}

type writeAfterDataFailResponseWriter struct {
	httptest.ResponseRecorder
	writeCount int
}

func (w *writeAfterDataFailResponseWriter) Write(p []byte) (int, error) {
	w.writeCount++
	if w.writeCount == 3 {
		return 0, errors.New("write failed")
	}
	return w.ResponseRecorder.Write(p)
}

func (w *writeAfterDataFailResponseWriter) Flush() error {
	return nil
}

type streamBadJSON struct{}

func (streamBadJSON) MarshalJSON() ([]byte, error) {
	return nil, errors.New("marshal failed")
}

func TestAcquireRecoveryLease_IsIdempotentWhenLeaseHeld(t *testing.T) {
	// Reset global lease map to isolate this test.
	restore(t, &recoveryLease)
	recoveryLease = &recoveryLeaseMap{entries: make(map[string]time.Time)}

	id := "regression-lease-task"
	if !acquireRecoveryLease(id) {
		t.Fatal("expected first acquireRecoveryLease to return true")
	}
	if acquireRecoveryLease(id) {
		t.Fatal("expected second acquireRecoveryLease within TTL to return false (lease still held)")
	}
}

func TestExtractAgentInfo(t *testing.T) {
	count, status := extractAgentInfo([]any{map[string]any{"status": "RUNNING"}})
	assert.Equal(t, 1, count)
	assert.Equal(t, "RUNNING", status)

	count, status = extractAgentInfo("nope")
	assert.Equal(t, 0, count)
	assert.Empty(t, status)
}

func TestExtractAgentInfoCoverage(t *testing.T) {
	count, status := extractAgentInfo([]any{map[string]any{"status": "RUNNING"}, map[string]any{"status": 42}})
	assert.Equal(t, 2, count)
	assert.Equal(t, "RUNNING", status)

	count, status = extractAgentInfo("unexpected")
	assert.Equal(t, 0, count)
	assert.Empty(t, status)

	count, status = extractAgentInfo([]any{map[string]any{"status": 42}})
	assert.Equal(t, 1, count)
	assert.Empty(t, status)

	count, status = extractAgentInfo([]any{"unexpected"})
	assert.Equal(t, 1, count)
	assert.Empty(t, status)

	count, status = extractAgentInfo(nil)
	assert.Equal(t, 0, count)
	assert.Empty(t, status)
}

func TestExtractTaskIDFromStreamPath(t *testing.T) {
	assert.Equal(t, "task-1", extractTaskIDFromStreamPath("/api/v1/stream/task-1/"))
	assert.Empty(t, extractTaskIDFromStreamPath("   "))
	assert.Empty(t, extractTaskIDFromStreamPath("/"))
}

func TestExtractTaskIDFromStreamPathCoverage(t *testing.T) {
	assert.Equal(t, "task-123", extractTaskIDFromStreamPath("/api/v1/stream/task-123"))
	assert.Equal(t, "stream", extractTaskIDFromStreamPath("/api/v1/stream/"))
	assert.Empty(t, extractTaskIDFromStreamPath(""))
}

func TestExtractTaskIDFromStreamPath_DotBase(t *testing.T) {
	assert.Empty(t, extractTaskIDFromStreamPath("/api/v1/stream/./"))
}

func TestHandler_CORSPreflightReturnsEarly(t *testing.T) {
	restore(t, &getQueries)
	getQueries = func(ctx context.Context) (*db.Queries, error) { return &db.Queries{}, nil }

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/stream/task-cors", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusNoContent, resp.Code)
}

func TestHandler_KeepAliveClientDisconnect(t *testing.T) {
	restore(t, &streamKeepAliveTimeout)
	streamKeepAliveTimeout = 30 * time.Millisecond

	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 91, Email: "keepalive-disconnect@test.com"})

	taskID := "keepalive-disconnect"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 91, "prompt", "gpt-4", run.OrchestrateTaskOptions{}))
	require.True(t, registry.MarkStarted(taskID))

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil).WithContext(ctx)
	resp := &failOnKeepAliveWriter{ResponseRecorder: httptest.NewRecorder()}
	Handler(resp, req)
	assert.GreaterOrEqual(t, resp.writeCount, 1)
}

func TestHandler_KeepAliveMarshalFailurePath(t *testing.T) {
	restore(t, &streamKeepAliveTimeout)
	streamKeepAliveTimeout = 30 * time.Millisecond

	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 88, Email: "marshal-fail@test.com"})

	taskID := "keepalive-marshal-fail"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 88, "prompt", "gpt-4", run.OrchestrateTaskOptions{}))
	require.True(t, registry.MarkStarted(taskID))

	originalMarshal := streamMarshalEvent
	restore(t, &streamMarshalEvent)
	streamMarshalEvent = func(h *streamHandler, v any) ([]byte, error) {
		if m, ok := v.(map[string]string); ok && m["type"] == "pulse" {
			return nil, errors.New("marshal failed")
		}
		return originalMarshal(h, v)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil).WithContext(ctx)
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestHandler_KeepAliveTimeoutPulse(t *testing.T) {
	restore(t, &streamKeepAliveTimeout)
	streamKeepAliveTimeout = 40 * time.Millisecond

	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 77, Email: "keepalive@test.com"})

	taskID := "keepalive-task"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 77, "prompt", "gpt-4", run.OrchestrateTaskOptions{}))
	require.True(t, registry.MarkStarted(taskID))

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil).WithContext(ctx)
	resp := httptest.NewRecorder()
	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"pulse"`)
	assert.Contains(t, resp.Body.String(), `"reason":"keep-alive"`)
}

func TestHandler_LoopTickerUntilTaskCompletes(t *testing.T) {
	restore(t, &streamStatusPollInterval)
	streamStatusPollInterval = 10 * time.Millisecond

	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 55, Email: "stream@test.com"})

	taskID := "loop-complete-task"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 55, "prompt", "gpt-4", run.OrchestrateTaskOptions{}))
	require.True(t, registry.MarkStarted(taskID))

	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil).WithContext(ctx)
	resp := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		time.Sleep(25 * time.Millisecond)
		_ = registry.Update(context.Background(), taskID, run.StatusCompleted, "done", "")
		close(done)
	}()

	Handler(resp, req)
	<-done

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"start"`)
	assert.Contains(t, resp.Body.String(), `"type":"complete"`)
}

func TestHandler_MethodNotAllowedAndDatabaseUnavailable(t *testing.T) {
	restore(t, &getQueries)
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/stream/task-1", nil)
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusMethodNotAllowed, resp.Code)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/stream/task-1", nil)
	resp = httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestHandler_UnauthorizedWhenUserMissing(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	swap(t, &getQueries, func(ctx context.Context) (*db.Queries, error) { return &db.Queries{}, nil })
	swap(t, &authWrapper, func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc { return next })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/task-no-user", nil)
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestNormalizeAgentStatuses(t *testing.T) {
	assert.Equal(t, []any{}, normalizeAgentStatuses(nil))

	var nilSlice []any
	assert.Equal(t, []any{}, normalizeAgentStatuses(nilSlice))

	var nilTypedMapSlice []map[string]any
	assert.Equal(t, []any{}, normalizeAgentStatuses(nilTypedMapSlice))

	var nilMap map[string]any
	assert.Equal(t, []any{}, normalizeAgentStatuses(nilMap))

	input := []any{map[string]any{"status": "QUEUED"}}
	assert.Equal(t, input, normalizeAgentStatuses(input))

	typed := []map[string]any{{"status": "QUEUED"}}
	assert.Equal(t, typed, normalizeAgentStatuses(typed))

	statusMap := map[string]any{"status": "QUEUED"}
	assert.Equal(t, statusMap, normalizeAgentStatuses(statusMap))

	assert.Equal(t, "raw", normalizeAgentStatuses("raw"))
}

func TestNormalizeAgentStatusesCoverage(t *testing.T) {
	assert.Equal(t, []any{}, normalizeAgentStatuses(nil))
	assert.Equal(t, []any{}, normalizeAgentStatuses(([]any)(nil)))

	var nilMap map[string]any
	assert.Equal(t, []any{}, normalizeAgentStatuses(nilMap))

	raw := []any{map[string]any{"status": "RUNNING"}}
	assert.Equal(t, raw, normalizeAgentStatuses(raw))
}

func TestNormalizeAgentStatuses_NilChannel(t *testing.T) {
	var ch chan int
	assert.Equal(t, []any{}, normalizeAgentStatuses(ch))

	var fn func()
	assert.Equal(t, []any{}, normalizeAgentStatuses(fn))

	var ptr *int
	assert.Equal(t, []any{}, normalizeAgentStatuses(ptr))
}

func TestStreamHandler_SendSSECleansMultilineAndWriteFailures(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-sse-newlines", rc: http.NewResponseController(resp)}
	require.NoError(t, h.sendSSE([]byte("  {\"type\":\"ping\", \n \"value\":true}  ")))
	assert.Contains(t, resp.Body.String(), `data: {"type":"ping",   "value":true}`)

	prefixOKThenDataFail := &writeAfterPrefixFailResponseWriter{}
	h = &streamHandler{w: prefixOKThenDataFail, taskID: "task-sse-data-fail", rc: http.NewResponseController(prefixOKThenDataFail)}
	require.Error(t, h.sendSSE([]byte(`{"type":"ping"}`)))

	dataOKThenSuffixFail := &writeAfterDataFailResponseWriter{}
	h = &streamHandler{w: dataOKThenSuffixFail, taskID: "task-sse-suffix-fail", rc: http.NewResponseController(dataOKThenSuffixFail)}
	require.Error(t, h.sendSSE([]byte(`{"type":"ping"}`)))
}

func TestStreamHandler_MarshalToPooledBufferFallbackAndError(t *testing.T) {
	restore(t, &bufferPool)
	bufferPool = sync.Pool{}

	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-marshal-fallback", rc: http.NewResponseController(resp)}
	data, err := h.marshalToPooledBuffer(map[string]string{"type": "ok"})
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"ok"}`, string(data))

	_, err = h.marshalToPooledBuffer(streamUnsupportedJSON{Value: make(chan int)})
	require.Error(t, err)
}

var benchmarkNormalizedAgentStatuses any

func BenchmarkNormalizeAgentStatuses(b *testing.B) {
	statuses := []any{map[string]any{"status": "RUNNING"}}
	var nilSlice []any
	var nilMap map[string]any
	var nilChannel chan int

	b.Run("statuses_slice", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			benchmarkNormalizedAgentStatuses = normalizeAgentStatuses(statuses)
		}
	})

	b.Run("nil_slice", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			benchmarkNormalizedAgentStatuses = normalizeAgentStatuses(nilSlice)
		}
	})

	b.Run("nil_map", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			benchmarkNormalizedAgentStatuses = normalizeAgentStatuses(nilMap)
		}
	})

	b.Run("nil_channel_reflect_fallback", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			benchmarkNormalizedAgentStatuses = normalizeAgentStatuses(nilChannel)
		}
	})
}

func TestRecoveryLeaseMapAcquireAndSweep(t *testing.T) {
	m := newRecoveryLeaseMap(10 * time.Millisecond)
	assert.True(t, m.acquire("task-a", time.Second))
	assert.False(t, m.acquire("task-a", time.Second))
	time.Sleep(15 * time.Millisecond)
	m.sweep()
	assert.True(t, m.acquire("task-a", time.Millisecond))
}

func TestRecoveryLeaseMap_AcquireAfterTTLSucceeds(t *testing.T) {
	m := &recoveryLeaseMap{entries: make(map[string]time.Time)}
	// Seed an already-stale entry.
	m.entries["task-1"] = time.Now().Add(-20 * time.Second)
	// acquire with a 15 s TTL must recognise the entry as stale and succeed.
	if !m.acquire("task-1", 15*time.Second) {
		t.Fatal("expected acquire on stale entry to succeed")
	}
}

func TestRecoveryLeaseMap_AcquireFirstTime(t *testing.T) {
	m := &recoveryLeaseMap{entries: make(map[string]time.Time)}
	// First acquire must succeed.
	if !m.acquire("task-1", 15*time.Second) {
		t.Fatal("expected first acquire to succeed")
	}
}

func TestRecoveryLeaseMap_AcquireWithinTTLReturnsFalse(t *testing.T) {
	m := &recoveryLeaseMap{entries: make(map[string]time.Time)}
	if !m.acquire("task-1", 15*time.Second) {
		t.Fatal("expected first acquire to succeed")
	}
	// Immediate second acquire must be blocked (lease not yet stale).
	if m.acquire("task-1", 15*time.Second) {
		t.Fatal("expected second acquire within TTL to fail")
	}
}

func TestRecoveryLeaseMap_NeverGrowsUnbounded(t *testing.T) {
	// Verify that repeated acquires for distinct task IDs whose leases have
	// all expired do not permanently accumulate in the map.
	const taskCount = 50
	const ttl = time.Millisecond // very short TTL for the test
	m := &recoveryLeaseMap{entries: make(map[string]time.Time), sweepTTL: ttl}
	for i := range taskCount {
		id := "task-" + string(rune('a'+i))
		m.acquire(id, ttl)
	}
	// Let all leases expire.
	time.Sleep(5 * time.Millisecond)
	m.sweep()
	if len(m.entries) != 0 {
		t.Errorf("expected map to be empty after sweep of expired entries, got %d", len(m.entries))
	}
}

func TestRecoveryLeaseMap_SweepRemovesStaleEntries(t *testing.T) {
	m := &recoveryLeaseMap{entries: make(map[string]time.Time)}
	// Seed two stale entries and one fresh one.
	m.entries["stale-1"] = time.Now().Add(-20 * time.Second)
	m.entries["stale-2"] = time.Now().Add(-30 * time.Second)
	m.entries["fresh-1"] = time.Now()
	m.sweep()
	if _, ok := m.entries["stale-1"]; ok {
		t.Error("stale-1 should have been evicted by sweep")
	}
	if _, ok := m.entries["stale-2"]; ok {
		t.Error("stale-2 should have been evicted by sweep")
	}
	if _, ok := m.entries["fresh-1"]; !ok {
		t.Error("fresh-1 should NOT have been evicted by sweep")
	}
}

func TestStreamHandler_DatabaseUnavailable(t *testing.T) {
	restore(t, &getQueries)
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/task_any", nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	assert.Contains(t, resp.Body.String(), "Database unavailable")
}

func TestStreamHandler_MarshalErrorBranches(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-marshal", userID: 1, rc: http.NewResponseController(resp)}

	_, err := h.marshalToPooledBuffer(make(chan int))
	require.Error(t, err)
}

func TestStreamHandler_SendSSEIgnoresFlushFailureAfterWrite(t *testing.T) {
	resp := &flushFailResponseWriter{ResponseRecorder: httptest.NewRecorder()}
	h := &streamHandler{w: resp, taskID: "task-flush", userID: 1, rc: http.NewResponseController(resp)}

	require.NoError(t, h.sendSSE([]byte(`{"type":"progress"}`)))
	assert.Contains(t, resp.Body.String(), `data: {"type":"progress"}`)
}

func TestStreamHandler_SendSSEReturnsWriteFailure(t *testing.T) {
	resp := &writeFailResponseWriter{}
	h := &streamHandler{w: resp, taskID: "task-write", userID: 1, rc: http.NewResponseController(resp)}

	require.Error(t, h.sendSSE([]byte(`{"type":"progress"}`)))
}

func TestStreamHandler_SendSSECollapsesMultilineData(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-multiline", userID: 1, rc: http.NewResponseController(resp)}

	require.NoError(t, h.sendSSE([]byte("{\"type\":\"progress\"}\n{\"extra\":true}\n")))
	assert.Equal(t, "data: {\"type\":\"progress\"} {\"extra\":true}\n\n", resp.Body.String())
}

func BenchmarkStreamHandlerSendSSE(b *testing.B) {
	payload := []byte(`{"type":"progress","agent_statuses":[{"status":"RUNNING","progress":0.5}],"pending_approval":null}`)
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-sse-bench", userID: 1, rc: http.NewResponseController(resp)}

	b.ReportAllocs()
	for b.Loop() {
		resp.Body.Reset()
		if err := h.sendSSE(payload); err != nil {
			b.Fatal(err)
		}
	}
}

func TestStreamHandler_MarshalToPooledBufferFallbackType(t *testing.T) {
	restore(t, &bufferPool)
	bufferPool = sync.Pool{}

	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-pool", userID: 1, rc: http.NewResponseController(resp)}
	_, err := h.marshalToPooledBuffer(map[string]string{"type": "ping"})
	require.NoError(t, err)
}

func TestStreamHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/stream/task_1", nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusMethodNotAllowed, resp.Code)
}

func TestStreamHandler_ProgressIncludesBudgetUsage(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 20, Email: "test@example.com"})

	taskID := "task-budget"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 20, "prompt", "gpt-4", run.OrchestrateTaskOptions{}))
	require.NoError(t, registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, []any{map[string]any{"tool": "search"}}, &run.BudgetUsage{ConsumedUSD: 1.25}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"budget_usage"`)
	assert.Contains(t, resp.Body.String(), `"tool_usage"`)
	assert.NotContains(t, resp.Body.String(), `"tool_events"`)
}

func TestStreamHandler_ProgressUsesEmptyArrayWhenAgentStatusesMissing(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 6, Email: "test@example.com"})

	taskID := "task-no-statuses"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 6, "prompt", "gpt-4", run.OrchestrateTaskOptions{})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"progress"`)
	assert.Contains(t, resp.Body.String(), `"agent_statuses":[]`)
	assert.NotContains(t, resp.Body.String(), `"agent_statuses":null`)
}

func TestStreamHandler_RecoversStaleUnstartedTask(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamUser(t, &auth.AuthenticatedUser{ID: 11, Email: "test@example.com"})
	restore(t, &orchestrateTask)

	called := make(chan struct{}, 1)
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts run.OrchestrateTaskOptions) {
		select {
		case called <- struct{}{}:
		default:
		}
	}

	taskID := "task-stale-unstarted"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 11, "prompt", "gpt-4", run.OrchestrateTaskOptions{})

	task := registry.Get(taskID)
	assert.NotNil(t, task)
	task.UpdatedAt = time.Now().Add(-40 * time.Second).Unix()
	serialized, marshalErr := json.Marshal(task)
	require.NoError(t, marshalErr)
	redisClient, clientErr := redis.GetClient()
	assert.NoError(t, clientErr)
	assert.NoError(t, redisClient.Set(context.Background(), "task:"+taskID, serialized, run.TaskTTL))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	select {
	case <-called:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected stale task recovery orchestration to be triggered")
	}
}
