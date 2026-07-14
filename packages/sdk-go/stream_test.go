package taskforceai

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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

func TestClient_StreamTaskStatus_DoesNotUseRequestTimeoutForBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(30 * time.Millisecond)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"taskId\":\"task-slow\",\"status\":\"completed\",\"result\":\"done\"}\n\n"))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:  "key",
		BaseURL: server.URL,
		Timeout: 5 * time.Millisecond,
	})
	stream, err := client.StreamTaskStatus(context.Background(), "task-slow")
	if err != nil {
		t.Fatalf("stream setup exceeded request timeout: %v", err)
	}
	defer func() { _ = stream.Close() }()
	status, err := stream.Next()
	if err != nil || status.Status != "completed" {
		t.Fatalf("expected completed event, got status=%+v err=%v", status, err)
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
	client := clientForServer(t, server)
	stream, err := client.StreamTaskStatus(context.Background(), "team/one task?")
	if err != nil {
		t.Fatalf("StreamTaskStatus failed: %v", err)
	}
	defer func() { _ = stream.Close() }()
}

func TestAPIRootURL_StripsDeveloperRouteForStreaming(t *testing.T) {
	got := apiRootURL("https://taskforceai.chat/api/v1/developer")
	if got != "https://taskforceai.chat/api/v1" {
		t.Fatalf("expected API root URL, got %q", got)
	}
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
