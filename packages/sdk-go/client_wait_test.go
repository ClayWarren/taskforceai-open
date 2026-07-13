package taskforceai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClient_RunTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if r.URL.Path == "/run" {
			_, _ = w.Write([]byte(`{"taskId": "task-run-1"}`))
		} else {
			_, _ = w.Write([]byte(`{"taskId": "task-run-1", "status": "completed", "result": "run-done"}`))
		}
	}))
	client := clientForServer(t, server)
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
	client := clientForServer(t, server)
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

	canceledServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-canceled", "status": "canceled", "error": "Run canceled"}`))
	}))
	defer canceledServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: canceledServer.URL})
	_, err = client.WaitForCompletion(context.Background(), "task-canceled", time.Millisecond, 1, nil)
	if err == nil || !strings.Contains(err.Error(), "Run canceled") {
		t.Errorf("expected canceled error, got %v", err)
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
