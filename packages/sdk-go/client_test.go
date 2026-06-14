package taskforceai

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("network unavailable")
}

func contextWithTraceParent(t *testing.T) context.Context {
	t.Helper()

	previousPropagator := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTextMapPropagator(previousPropagator)
	})

	traceID, err := trace.TraceIDFromHex("00000000000000000000000000000001")
	if err != nil {
		t.Fatalf("parse trace ID: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("0000000000000001")
	if err != nil {
		t.Fatalf("parse span ID: %v", err)
	}
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
	})

	return trace.ContextWithSpanContext(context.Background(), spanContext)
}

func TestNewClient_Defaults(t *testing.T) {
	client, err := NewClient(TaskForceAIOptions{APIKey: "key"})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	if client.baseURL != DefaultBaseURL {
		t.Errorf("expected default base URL, got %s", client.baseURL)
	}
	if client.timeout != DefaultTimeout {
		t.Errorf("expected default timeout, got %v", client.timeout)
	}
}

func TestNewClient_EmptyAPIKey(t *testing.T) {
	_, err := NewClient(TaskForceAIOptions{})
	if err == nil {
		t.Error("expected error for empty API key, got nil")
	}

	// Mock mode should allow empty API key
	client, err := NewClient(TaskForceAIOptions{MockMode: true})
	if err != nil {
		t.Fatalf("NewClient with mock mode failed: %v", err)
	}
	if client == nil {
		t.Error("expected client, got nil")
	}
}

func TestStripAPIKeyOnCrossHostRedirect(t *testing.T) {
	originURL, _ := url.Parse("https://api.taskforceai.chat/run")
	sameHostURL, _ := url.Parse("https://api.taskforceai.chat/redirected")
	crossHostURL, _ := url.Parse("https://files.example/download")

	origin := &http.Request{URL: originURL, Header: http.Header{}}
	sameHost := &http.Request{URL: sameHostURL, Header: http.Header{}}
	crossHost := &http.Request{URL: crossHostURL, Header: http.Header{}}
	origin.Header.Set(apiKeyHeader, "secret")
	sameHost.Header.Set(apiKeyHeader, "secret")
	crossHost.Header.Set(apiKeyHeader, "secret")

	if err := stripAPIKeyOnCrossHostRedirect(sameHost, []*http.Request{origin}); err != nil {
		t.Fatalf("same-host redirect returned error: %v", err)
	}
	if sameHost.Header.Get(apiKeyHeader) != "secret" {
		t.Fatalf("same-host redirect should preserve api key, got %q", sameHost.Header.Get(apiKeyHeader))
	}

	if err := stripAPIKeyOnCrossHostRedirect(crossHost, []*http.Request{origin}); err != nil {
		t.Fatalf("cross-host redirect returned error: %v", err)
	}
	if crossHost.Header.Get(apiKeyHeader) != "" {
		t.Fatalf("cross-host redirect should strip api key, got %q", crossHost.Header.Get(apiKeyHeader))
	}
}

func TestStripAPIKeyOnCrossHostRedirectStopsAfterMaxHops(t *testing.T) {
	targetURL, _ := url.Parse("https://api.taskforceai.chat/final")
	target := &http.Request{URL: targetURL, Header: http.Header{}}
	via := make([]*http.Request, maxRedirectHops)
	for i := range via {
		via[i] = &http.Request{URL: targetURL}
	}

	if err := stripAPIKeyOnCrossHostRedirect(target, via); !errors.Is(err, errTooManyRedirects) {
		t.Fatalf("expected errTooManyRedirects, got %v", err)
	}
}

func TestClient_doRequest_Errors(t *testing.T) {
	// 1. Marshaling error
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
	resp, err := client.doRequestInternal(context.Background(), "POST", "/", make(chan int))
	if err == nil {
		_ = resp.Body.Close()
		t.Error("expected marshal error for chan type, got nil")
	}

	// 2. NewRequest error (invalid method)
	resp, err = client.doRequestInternal(context.Background(), "INVALID METHOD", "/", nil)
	if err == nil {
		_ = resp.Body.Close()
		t.Error("expected error for invalid HTTP method, got nil")
	}

	// 3. Client.Do error (network error)
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "http://example.invalid"})
	client.httpClient = &http.Client{Transport: failingTransport{}}
	resp, err = client.doRequestInternal(context.Background(), "GET", "/", nil)
	if err == nil {
		_ = resp.Body.Close()
		t.Error("expected network error, got nil")
	}
}

func TestClient_doRequest_AuthHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "secret-key" {
			t.Errorf("expected x-api-key header, got %s", r.Header.Get("x-api-key"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		BaseURL: server.URL,
		APIKey:  "secret-key",
	})
	resp, _ := client.doRequest(context.Background(), "GET", "/", nil)
	if resp != nil {
		_ = resp.Body.Close()
	}
}

func TestClient_doRequest_Hook(t *testing.T) {
	hookCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
		ResponseHook: func(statusCode int, header map[string][]string) {
			hookCalled = true
			if statusCode != http.StatusCreated {
				t.Errorf("expected status 201 in hook, got %d", statusCode)
			}
		},
	})

	resp, _ := client.doRequest(context.Background(), "GET", "/", nil)
	if resp != nil {
		_ = resp.Body.Close()
	}
	if !hookCalled {
		t.Error("expected response hook to be called")
	}
}

func TestClient_doRequest_RetriesOnTransientStatusAndSucceeds(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := attempts.Add(1)
		if current == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
	})

	resp, err := client.doRequest(context.Background(), "GET", "/", nil)
	if err != nil {
		t.Fatalf("expected retry to succeed, got error: %v", err)
	}
	if resp != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %#v", resp)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("expected 2 attempts, got %d", got)
	}
}

func TestClient_doRequest_RetriesOnRateLimitAndSucceeds(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := attempts.Add(1)
		if current == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
	})

	resp, err := client.doRequest(context.Background(), "GET", "/", nil)
	if err != nil {
		t.Fatalf("expected retry to succeed, got error: %v", err)
	}
	if resp != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if resp == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %#v", resp)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("expected 2 attempts, got %d", got)
	}
}

func TestClient_doRequest_StopsWhenContextCanceledDuringBackoff(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
	})

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	resp, err := client.doRequest(ctx, "GET", "/", nil)
	if err == nil || !errors.Is(err, context.Canceled) {
		if resp != nil {
			_ = resp.Body.Close()
		}
		t.Fatalf("expected context canceled error, got resp=%v err=%v", resp, err)
	}
	if got := attempts.Load(); got != 1 {
		t.Fatalf("expected one request before cancellation, got %d", got)
	}
}

func TestClient_SubmitTask_WithOpts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-with-opts"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.SubmitTask(context.Background(), "hello", &TaskSubmissionOptions{ModelID: "test-model"})
	if err != nil {
		t.Errorf("SubmitTask with opts failed: %v", err)
	}
}

func TestClient_SubmitTask_WithAttachments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"taskId": "task-with-images"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	taskID, err := client.SubmitTask(context.Background(), "hello", &TaskSubmissionOptions{
		Images: []ImageAttachment{{Data: "aGVsbG8=", MimeType: "image/png"}},
	})
	if err != nil || taskID != "task-with-images" {
		t.Fatalf("SubmitTask with attachments failed: taskID=%s err=%v", taskID, err)
	}
}

func TestClient_SubmitTask_Errors(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})

	// 1. Prompt required
	_, err := client.SubmitTask(context.Background(), "", nil)
	if err == nil || err.Error() != "prompt is required" {
		t.Errorf("expected prompt required error, got %v", err)
	}

	// 2. Server 500 error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err = client.SubmitTask(context.Background(), "hello", nil)
	if err == nil || !strings.Contains(err.Error(), "status 500") {
		t.Errorf("expected 500 error, got %v", err)
	}

	// 3. Malformed JSON response
	malformedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{malformed}`))
	}))
	defer malformedServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: malformedServer.URL})
	_, err = client.SubmitTask(context.Background(), "hello", nil)
	if err == nil {
		t.Error("expected JSON decode error, got nil")
	}
}

func TestClient_GetTaskStatus_Errors(t *testing.T) {
	// 1. 404 error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetTaskStatus(context.Background(), "missing")
	if err == nil || !strings.Contains(err.Error(), "status 404") {
		t.Errorf("expected 404 error, got %v", err)
	}

	// 2. Malformed JSON
	malformedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{malformed}`))
	}))
	defer malformedServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: malformedServer.URL})
	_, err = client.GetTaskStatus(context.Background(), "id")
	if err == nil {
		t.Error("expected JSON decode error, got nil")
	}
}

func TestClient_GetTaskStatus_EscapesTaskIDPathSegment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/status/team%2Fone%20task%3F" {
			t.Errorf("expected escaped task status path, got %s", r.URL.EscapedPath())
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId":"team/one task?","status":"completed"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetTaskStatus(context.Background(), "team/one task?")
	if err != nil {
		t.Fatalf("GetTaskStatus failed: %v", err)
	}
}

func TestClient_RunTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if r.URL.Path == "/run" {
			_, _ = w.Write([]byte(`{"taskId": "task-run-1"}`))
		} else {
			_, _ = w.Write([]byte(`{"taskId": "task-run-1", "status": "completed", "result": "run-done"}`))
		}
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	status, err := client.RunTask(context.Background(), "run me", nil, 1*time.Millisecond, 2, nil)
	if err != nil {
		t.Fatalf("RunTask failed: %v", err)
	}
	if status.TaskID != "task-run-1" || *status.Result != "run-done" {
		t.Errorf("unexpected RunTask result: %+v", status)
	}

	// Test callback
	callbackCalled := false
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-cb", "status": "completed", "result": "cb-done"}`))
	}))
	defer server.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, _ = client.WaitForCompletion(context.Background(), "task-cb", 1*time.Millisecond, 1, func(status TaskStatus) {
		callbackCalled = true
	})
	if !callbackCalled {
		t.Error("expected callback to be called")
	}

	// Test RunTask submission error
	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer errServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: errServer.URL})
	_, err = client.RunTask(context.Background(), "run me", nil, 0, 0, nil)
	if err == nil {
		t.Error("expected RunTask submission error, got nil")
	}
}

func TestClient_WaitForCompletion_Failures(t *testing.T) {
	// 1. Task failure path
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-fail", "status": "failed", "error": "test failure"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.WaitForCompletion(context.Background(), "task-fail", 1*time.Millisecond, 1, nil)
	if err == nil || !strings.Contains(err.Error(), "test failure") {
		t.Errorf("expected task failure error, got %v", err)
	}

	awaitingApprovalServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-approval", "status": "awaiting_approval", "error": "Approval required"}`))
	}))
	defer awaitingApprovalServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: awaitingApprovalServer.URL})
	_, err = client.WaitForCompletion(context.Background(), "task-approval", 1*time.Millisecond, 1, nil)
	if err == nil || !strings.Contains(err.Error(), "Approval required") {
		t.Errorf("expected awaiting approval error, got %v", err)
	}

	// 2. Timeout path
	timeoutServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-timeout", "status": "processing"}`))
	}))
	defer timeoutServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: timeoutServer.URL})
	_, err = client.WaitForCompletion(context.Background(), "task-timeout", 1*time.Millisecond, 1, nil)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Errorf("expected timeout error, got %v", err)
	}

	// 3. Context cancellation
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.WaitForCompletion(ctx, "task-cancel", 1*time.Millisecond, 5, nil)
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Errorf("expected context cancelled error, got %v", err)
	}

	// 4. Polling error (e.g. 500 during poll)
	pollErrServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer pollErrServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: pollErrServer.URL})
	_, err = client.WaitForCompletion(context.Background(), "id", 0, 0, nil) // use defaults
	if err == nil {
		t.Error("expected polling error, got nil")
	}

	// 5. Context Done in select
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "id", "status": "processing"}`))
	}))
	defer server.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	ctx, cancel = context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	_, err = client.WaitForCompletion(ctx, "id", 50*time.Millisecond, 2, nil)
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Errorf("expected context canceled in select, got %v", err)
	}
}

func TestClient_StreamTaskStatus(t *testing.T) {
	ctx := contextWithTraceParent(t)
	var streamHookStatus int

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/run" {
			if r.Header.Get("X-SDK-Language") != "go" {
				t.Errorf("expected X-SDK-Language go on submit, got %s", r.Header.Get("X-SDK-Language"))
			}
			if r.Header.Get("traceparent") == "" {
				t.Error("expected traceparent header on submit")
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"taskId": "task-stream-1"}`))
			return
		}

		if r.Header.Get("x-api-key") != "stream-key" {
			t.Errorf("expected x-api-key header in stream, got %s", r.Header.Get("x-api-key"))
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("expected text/event-stream accept header, got %s", r.Header.Get("Accept"))
		}
		if r.Header.Get("X-SDK-Language") != "go" {
			t.Errorf("expected X-SDK-Language go in stream, got %s", r.Header.Get("X-SDK-Language"))
		}
		if r.Header.Get("traceparent") == "" {
			t.Error("expected traceparent header in stream")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"taskId\": \"task-stream-1\", \"status\": \"processing\"}\n\n"))
		_, _ = w.Write([]byte("data: {\"taskId\": \"task-stream-1\", \"status\": \"completed\", \"result\": \"streamed\"}\n\n"))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		BaseURL: server.URL,
		APIKey:  "stream-key",
		ResponseHook: func(statusCode int, _ map[string][]string) {
			streamHookStatus = statusCode
		},
	})

	// Test RunTaskStream
	stream, err := client.RunTaskStream(ctx, "stream me", nil)
	if err != nil {
		t.Fatalf("RunTaskStream failed: %v", err)
	}
	defer func() { _ = stream.Close() }()
	if streamHookStatus != http.StatusOK {
		t.Fatalf("expected stream response hook status 200, got %d", streamHookStatus)
	}

	if stream.TaskID() != "task-stream-1" {
		t.Errorf("expected task ID task-stream-1, got %s", stream.TaskID())
	}

	// First event
	ev1, err := stream.Next()
	if err != nil {
		t.Fatalf("Next ev1 failed: %v", err)
	}
	if ev1.Status != "processing" {
		t.Errorf("expected status processing, got %s", ev1.Status)
	}

	// Second event
	ev2, err := stream.Next()
	if err != nil {
		t.Fatalf("Next ev2 failed: %v", err)
	}
	if ev2.Status != "completed" || *ev2.Result != "streamed" {
		t.Errorf("unexpected status/result: %+v", ev2)
	}

	// Close
	if err := stream.Close(); err != nil {
		t.Errorf("Close failed: %v", err)
	}
}

func TestClient_StreamTaskStatus_EscapesTaskIDPathSegment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/stream/team%2Fone%20task%3F" {
			t.Errorf("expected escaped stream path, got %s", r.URL.EscapedPath())
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"taskId\":\"team/one task?\",\"status\":\"completed\"}\n\n"))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	stream, err := client.StreamTaskStatus(context.Background(), "team/one task?")
	if err != nil {
		t.Fatalf("StreamTaskStatus failed: %v", err)
	}
	defer func() { _ = stream.Close() }()
}

func TestClient_StreamTaskStatus_Errors(t *testing.T) {
	// 1. Submission error for RunTaskStream
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "http://invalid"})
	_, err := client.RunTaskStream(context.Background(), "prompt", nil)
	if err == nil {
		t.Error("expected RunTaskStream submission error, got nil")
	}

	// 2. NewRequest error
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: " :invalid-url"})
	_, err = client.StreamTaskStatus(context.Background(), "id")
	if err == nil {
		t.Error("expected StreamTaskStatus request error, got nil")
	}

	// 3. Client.Do error
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "http://non-existent-domain.test"})
	_, err = client.StreamTaskStatus(context.Background(), "id")
	if err == nil {
		t.Error("expected network error, got nil")
	}

	// 4. Non-200 status
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err = client.StreamTaskStatus(context.Background(), "task-forbidden")
	if err == nil || !strings.Contains(err.Error(), "status 403") {
		t.Errorf("expected 403 error, got %v", err)
	}

	// 5. Malformed JSON in stream
	jsonServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {malformed}\n\n"))
	}))
	defer jsonServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: jsonServer.URL})
	stream, _ := client.StreamTaskStatus(context.Background(), "task-malformed")
	_, err = stream.Next()
	if err == nil {
		t.Error("expected JSON unmarshal error, got nil")
	}
	_ = stream.Close()

	// 6. Reader error (connection closed)
	readerErrServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// Close immediately
	}))
	defer readerErrServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: readerErrServer.URL})
	stream, _ = client.StreamTaskStatus(context.Background(), "id")
	_, err = stream.Next()
	if err == nil {
		t.Error("expected EOF or read error, got nil")
	}
	_ = stream.Close()

	// 7. Context cancellation during Next
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stream = &sseStream{ctx: ctx}
	_, err = stream.Next()
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context cancelled, got %v", err)
	}
}

func TestSSEStreamReadLineWithLimit(t *testing.T) {
	stream := &sseStream{
		resp:   &http.Response{Body: io.NopCloser(strings.NewReader("data: hello"))},
		reader: bufio.NewReader(strings.NewReader("data: hello")),
	}

	line, err := stream.readLineWithLimit(32)
	if err != nil {
		t.Fatalf("readLineWithLimit failed: %v", err)
	}
	if line != "data: hello" {
		t.Fatalf("expected partial EOF line, got %q", line)
	}
}

func TestSSEStreamReadLineWithLimitClosesOversizedLine(t *testing.T) {
	closed := false
	stream := &sseStream{
		resp: &http.Response{
			Body: closeFuncReadCloser{
				Reader: strings.NewReader(strings.Repeat("x", 12)),
				close: func() error {
					closed = true
					return nil
				},
			},
		},
	}
	stream.reader = bufio.NewReaderSize(stream.resp.Body, 4)

	_, err := stream.readLineWithLimit(8)
	if err == nil || !strings.Contains(err.Error(), "sse line exceeds maximum length") {
		t.Fatalf("expected oversized line error, got %v", err)
	}
	if !closed {
		t.Fatal("expected oversized stream to close response body")
	}
}

type closeFuncReadCloser struct {
	io.Reader
	close func() error
}

func (c closeFuncReadCloser) Close() error {
	return c.close()
}

func TestSSEStream_Close(t *testing.T) {
	// Test Close when resp is nil
	stream := &sseStream{cancel: func() {}}
	if err := stream.Close(); err != nil {
		t.Errorf("Close with nil resp failed: %v", err)
	}
}
