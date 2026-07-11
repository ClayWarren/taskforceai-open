package run

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

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/inngest/inngestgo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	runpkg "github.com/TaskForceAI/go-engine/pkg/run"
)

func setupInngestRouter(wg *sync.WaitGroup) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterInngestHandler(api, wg)
	return r
}

func TestRegisterInngestHandler_InvalidJSON(t *testing.T) {
	router := setupInngestRouter(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBufferString("{invalid"))
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	// Huma v2 returns "validation failed" for invalid JSON in body unmarshalling
	assert.Contains(t, resp.Body.String(), "validation failed")
}

func TestRegisterInngestHandler_IgnoresOtherEvents(t *testing.T) {
	router := setupInngestRouter(nil)
	body := map[string]any{
		"name": "other.event",
		"data": map[string]any{"ok": true},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "ok")
}

func TestRegisterInngestHandler_TaskExecute(t *testing.T) {
	restore(t, &orchestrateTask)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	called := false
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		called = true
		if taskID != "task-123" || userID != 42 || prompt != "hello" || modelID != "gpt-4" {
			t.Errorf("unexpected args: %v %v %v %v", taskID, userID, prompt, modelID)
		}
		if !opts.QuickModeEnabled {
			t.Errorf("expected quick mode from options payload")
		}
	}

	router := setupInngestRouter(&wg)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-123",
			"userId":  42,
			"prompt":  "hello",
			"modelId": "gpt-4",
			"options": map[string]any{
				"quickModeEnabled": true,
			},
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	wg.Wait()

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.True(t, called)
}

func TestRegisterInngestHandler_TaskExecute_DetachesFromRequestCancellation(t *testing.T) {
	restore(t, &orchestrateTask)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	gate := make(chan struct{})
	started := make(chan struct{})
	ctxErrCh := make(chan error, 1)
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		close(started)
		<-gate
		ctxErrCh <- ctx.Err()
	}

	router := setupInngestRouter(&wg)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-context-detach",
			"userId":  9,
			"prompt":  "hello",
			"modelId": "gpt-4",
		},
	}
	payload, _ := json.Marshal(body)
	requestCtx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload)).WithContext(requestCtx)
	resp := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(resp, req)
		close(done)
	}()

	select {
	case <-started:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected orchestrateTask to be called")
	}
	cancel()
	close(gate)

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected handler to finish after task is released")
	}
	wg.Wait()

	assert.Equal(t, http.StatusOK, resp.Code)
	select {
	case err := <-ctxErrCh:
		require.NoError(t, err)
	default:
		t.Fatal("expected orchestrateTask to be called")
	}
}

func TestExecuteInngestTask_DevModeReturnsBeforeExecutionFinishes(t *testing.T) {
	t.Setenv("INNGEST_DEV", "1")
	restore(t, &orchestrateTask)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	started := make(chan struct{})
	release := make(chan struct{})
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		close(started)
		<-release
	}

	err := executeInngestTask(context.Background(), &wg, taskExecuteEventData{
		TaskID:  "task-dev-async",
		UserID:  11,
		Prompt:  "hello",
		ModelID: "gpt-4",
	})
	require.NoError(t, err)

	select {
	case <-started:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected task execution to start")
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("expected task execution to continue after the callback returns")
	case <-time.After(100 * time.Millisecond):
	}

	close(release)
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected async task execution to finish")
	}
}

func TestRegisterInngestHandler_TaskExecute_LegacyOptsKey(t *testing.T) {
	restore(t, &orchestrateTask)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	called := false
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		called = true
		if taskID != "task-legacy" || userID != 7 || prompt != "legacy" || modelID != "gpt-4.1" {
			t.Errorf("unexpected args: %v %v %v %v", taskID, userID, prompt, modelID)
		}
		if !opts.QuickModeEnabled {
			t.Errorf("expected quick mode from legacy opts payload")
		}
		if opts.Source != "web" {
			t.Errorf("expected source to be set from top-level payload, got %q", opts.Source)
		}
		if !opts.IsEval {
			t.Errorf("expected isEval to be set from top-level payload")
		}
	}

	router := setupInngestRouter(&wg)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-legacy",
			"userId":  7,
			"prompt":  "legacy",
			"modelId": "gpt-4.1",
			"opts": map[string]any{
				"quickModeEnabled": true,
			},
			"source": "web",
			"isEval": true,
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	wg.Wait()

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.True(t, called)
}

func TestRegisterInngestHandler_TaskExecute_InvalidOptionsUsesDefaults(t *testing.T) {
	restore(t, &orchestrateTask)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	called := false
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		called = true
		assert.False(t, opts.QuickModeEnabled)
		assert.Equal(t, "web", opts.Source)
		assert.True(t, opts.IsEval)
	}

	router := setupInngestRouter(&wg)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-invalid-options",
			"userId":  7,
			"prompt":  "legacy",
			"modelId": "gpt-4.1",
			"options": "invalid",
			"source":  "web",
			"isEval":  true,
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	wg.Wait()

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.True(t, called)
}

func TestRegisterInngestHandler_TaskExecute_CapacityExceeded(t *testing.T) {
	restore(t, &orchestrateTask)
	restore(t, &acquireTaskExecutionSlot)

	called := false
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		called = true
	}
	acquireTaskExecutionSlot = func() (func(), bool) {
		return nil, false
	}

	router := setupInngestRouter(nil)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-capacity",
			"userId":  21,
			"prompt":  "load",
			"modelId": "gpt-4",
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
	assert.False(t, called)
}

func TestRegisterInngestHandler_TaskExecute_RejectsFractionalUserID(t *testing.T) {
	router := setupInngestRouter(nil)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-fractional-user",
			"userId":  42.5,
			"prompt":  "hello",
			"modelId": "gpt-4",
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRegisterInngestHandler_AgentPulse_WaitsForExecution(t *testing.T) {
	restore(t, &orchestratePulseTurn)

	var wg sync.WaitGroup
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	orchestratePulseTurn = func(ctx context.Context, agentID string, reason string) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
	}

	router := setupInngestRouter(&wg)
	body := map[string]any{
		"name": "agent.pulse",
		"data": map[string]any{
			"agentId": "agent-123",
			"reason":  "manual",
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(resp, req)
		close(done)
	}()

	select {
	case <-started:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected pulse execution to start")
	}

	select {
	case <-done:
		t.Fatal("expected handler to wait for pulse execution")
	case <-time.After(500 * time.Millisecond):
		// Response should wait for pulse execution to finish.
	}

	close(release)
	wg.Wait()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected handler to return after pulse execution completes")
	}
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRegisterInngestHandler_AgentPulse_CapacityExceeded(t *testing.T) {
	restore(t, &orchestratePulseTurn)
	restore(t, &acquireTaskExecutionSlot)

	called := false
	orchestratePulseTurn = func(ctx context.Context, agentID string, reason string) {
		called = true
	}
	acquireTaskExecutionSlot = func() (func(), bool) {
		return nil, false
	}

	router := setupInngestRouter(nil)
	body := map[string]any{
		"name": "agent.pulse",
		"data": map[string]any{
			"agentId": "agent-capacity",
			"reason":  "manual",
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
	assert.False(t, called)
}

func TestRegisterInngestHandler_TaskExecute_RejectsOutOfRangeUserID(t *testing.T) {
	router := setupInngestRouter(nil)
	body := map[string]any{
		"name": "task.execute",
		"data": map[string]any{
			"taskId":  "task-out-of-range-user",
			"userId":  float64(2147483648),
			"prompt":  "hello",
			"modelId": "gpt-4",
		},
	}
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBuffer(payload))
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestInngestLenientTaskOptions_NullAndEmptyPayloads(t *testing.T) {
	var opts inngestLenientTaskOptions
	require.NoError(t, opts.UnmarshalJSON(nil))
	assert.False(t, opts.set)
	assert.False(t, opts.invalid)

	require.NoError(t, opts.UnmarshalJSON([]byte("null")))
	assert.False(t, opts.set)
	assert.False(t, opts.invalid)
}

func TestParseInngestTaskExecuteDataValidationBranches(t *testing.T) {
	tests := []json.RawMessage{
		json.RawMessage(`{`),
		json.RawMessage(`{"userId":1,"prompt":"hello","modelId":"gpt-4"}`),
		json.RawMessage(`{"taskId":"task","prompt":"hello","modelId":"gpt-4"}`),
		json.RawMessage(`{"taskId":"task","userId":1,"modelId":"gpt-4"}`),
		json.RawMessage(`{"taskId":"task","userId":1,"prompt":"hello"}`),
	}

	for _, input := range tests {
		_, err := parseInngestTaskExecuteData(input)
		require.Error(t, err)
	}
}

func TestRegisterInngestHandler_AgentPulseInvalidData(t *testing.T) {
	router := setupInngestRouter(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", bytes.NewBufferString(`{"name":"agent.pulse","data":"bad"}`))
	resp := serve(router, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestExecuteInngestPulse_DevModeReturnsBeforeExecutionFinishes(t *testing.T) {
	t.Setenv("INNGEST_DEV", "1")
	restore(t, &orchestratePulseTurn)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	started := make(chan struct{})
	release := make(chan struct{})
	orchestratePulseTurn = func(ctx context.Context, agentID string, reason string) {
		close(started)
		<-release
	}

	err := executeInngestPulse(context.Background(), &wg, "agent-dev-async", "manual")
	require.NoError(t, err)

	select {
	case <-started:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected pulse execution to start")
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("expected pulse execution to continue after callback returns")
	case <-time.After(100 * time.Millisecond):
	}

	close(release)
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected async pulse execution to finish")
	}
}

func TestInngestFunctionCallbacks(t *testing.T) {
	restore(t, &orchestrateTask)
	restore(t, &orchestratePulseTurn)
	restore(t, &acquireTaskExecutionSlot)

	var wg sync.WaitGroup
	taskCalled := make(chan runpkg.OrchestrateTaskOptions, 1)
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts runpkg.OrchestrateTaskOptions) {
		assert.Equal(t, "task-fn", taskID)
		assert.Equal(t, 42, userID)
		assert.Equal(t, "hello", prompt)
		assert.Equal(t, "gpt-4", modelID)
		taskCalled <- opts
	}

	taskFn := newTaskExecuteInngestFunction(&wg)
	res, err := taskFn(context.Background(), inngestgo.Input[taskExecuteEventData]{
		Event: inngestgo.GenericEvent[taskExecuteEventData]{
			Data: taskExecuteEventData{
				TaskID:  "task-fn",
				UserID:  42,
				Prompt:  "hello",
				ModelID: "gpt-4",
				Source:  "api",
				IsEval:  true,
			},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "ok", res)
	wg.Wait()

	select {
	case opts := <-taskCalled:
		assert.Equal(t, "api", opts.Source)
		assert.True(t, opts.IsEval)
	default:
		t.Fatal("expected task callback to run")
	}

	pulseCalled := make(chan string, 1)
	orchestratePulseTurn = func(ctx context.Context, agentID string, reason string) {
		assert.Equal(t, "agent-fn", agentID)
		pulseCalled <- reason
	}
	pulseFn := newAgentPulseInngestFunction(&wg)
	res, err = pulseFn(context.Background(), inngestgo.Input[agentPulseEventData]{
		Event: inngestgo.GenericEvent[agentPulseEventData]{
			Data: agentPulseEventData{AgentID: "agent-fn", Reason: "manual"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "ok", res)
	wg.Wait()

	select {
	case reason := <-pulseCalled:
		assert.Equal(t, "manual", reason)
	default:
		t.Fatal("expected pulse callback to run")
	}
}

func TestNewInngestServeHandler_Unconfigured(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "")

	handler := NewInngestServeHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestNewInngestServeHandler_ConfiguredDevMode(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "1")

	handler := NewInngestServeHandler(nil)
	require.NotNil(t, handler)
}

func TestNewInngestServeHandler_RegistrationErrors(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "1")
	restore(t, &registerTaskExecuteInngestFunction)
	restore(t, &registerAgentPulseInngestFunction)

	taskRegistered := false
	registerTaskExecuteInngestFunction = func(client inngestgo.Client, shutdownGroup *sync.WaitGroup) error {
		taskRegistered = true
		return errors.New("task registration failed")
	}
	pulseRegistered := false
	registerAgentPulseInngestFunction = func(client inngestgo.Client, shutdownGroup *sync.WaitGroup) error {
		pulseRegistered = true
		return errors.New("pulse registration failed")
	}

	handler := NewInngestServeHandler(nil)
	require.NotNil(t, handler)
	assert.True(t, taskRegistered)
	assert.True(t, pulseRegistered)
}

func BenchmarkParseInngestTaskExecuteData(b *testing.B) {
	data := json.RawMessage(`{
		"taskId": "task-bench",
		"userId": 42,
		"prompt": "summarize this market report",
		"modelId": "openai/gpt-5.6-sol",
		"source": "web",
		"isEval": true,
		"options": {
			"quickModeEnabled": true,
			"computerUseEnabled": true,
			"computerUseTarget": "virtual",
			"autonomyEnabled": true,
			"agentCount": 4,
			"attachmentCount": 2,
			"roleModels": {
				"researcher": "openai/gpt-5.6-sol",
				"writer": "anthropic/claude-sonnet-4.5"
			},
			"clientMCPTools": [
				{"serverName": "drive", "toolName": "search", "title": "Search Drive"}
			],
			"researchWorkflow": {
				"workflow": "investment_dossier",
				"requiredCitations": true,
				"preferredExports": ["pdf", "xlsx"],
				"sourcePolicy": "public_and_attached"
			}
		}
	}`)

	b.ReportAllocs()
	for b.Loop() {
		parsed, err := parseInngestTaskExecuteData(data)
		if err != nil {
			b.Fatal(err)
		}
		if parsed.Options.AgentCount != 4 || parsed.Options.Source != "web" || !parsed.Options.IsEval {
			b.Fatalf("unexpected parsed options: %+v", parsed.Options)
		}
	}
}
