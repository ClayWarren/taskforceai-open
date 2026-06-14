package taskforceai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClient_CreateThread(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["title"] != "My Thread" {
			t.Errorf("expected title My Thread")
		}

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id": 1, "title": "My Thread"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	thread, err := client.CreateThread(context.Background(), &CreateThreadOptions{Title: "My Thread"})
	if err != nil {
		t.Fatalf("CreateThread failed: %v", err)
	}
	if thread.ID != 1 {
		t.Errorf("expected ID 1, got %d", thread.ID)
	}
}

func TestClient_ListThreads(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"threads": [{"id": 1}], "total": 1}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	resp, err := client.ListThreads(context.Background(), 10, 0)
	if err != nil {
		t.Fatalf("ListThreads failed: %v", err)
	}
	if len(resp.Threads) != 1 {
		t.Errorf("expected 1 thread")
	}
}

func TestClient_GetThread(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/threads/1" {
			t.Errorf("expected /threads/1, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id": 1, "title": "Existing"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	thread, err := client.GetThread(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetThread failed: %v", err)
	}
	if thread.Title != "Existing" {
		t.Errorf("unexpected thread title: %s", thread.Title)
	}
}

func TestClient_DeleteThread(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("delete endpoint should not be called by SDK")
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	err := client.DeleteThread(context.Background(), 1)
	if err == nil {
		t.Fatal("expected DeleteThread to fail")
	}
	if got := err.Error(); got == "" || !strings.Contains(got, "not supported") {
		t.Fatalf("unexpected DeleteThread error: %v", err)
	}
}

func TestClient_GetThreadMessages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/threads/1/messages" {
			t.Errorf("expected /threads/1/messages")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"messages": [{"id": 100, "content": "hello"}], "total": 1}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	resp, err := client.GetThreadMessages(context.Background(), 1, 10, 0)
	if err != nil {
		t.Fatalf("GetThreadMessages failed: %v", err)
	}
	if len(resp.Messages) != 1 || resp.Messages[0].Content != "hello" {
		t.Errorf("unexpected messages: %+v", resp)
	}
}

func TestClient_RunInThread(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/threads/1/runs" {
			t.Errorf("expected POST /threads/1/runs")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["prompt"] != "run this" {
			t.Errorf("expected prompt run this")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"task_id": "task-1"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	resp, err := client.RunInThread(context.Background(), 1, ThreadRunOptions{Prompt: "run this"})
	if err != nil {
		t.Fatalf("RunInThread failed: %v", err)
	}
	if resp.TaskID != "task-1" {
		t.Errorf("expected task-1, got %s", resp.TaskID)
	}

	// Error: empty prompt
	_, err = client.RunInThread(context.Background(), 1, ThreadRunOptions{})
	if err == nil {
		t.Error("expected empty prompt error")
	}
}

func TestClient_CreateThreadWithMetadataAndErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["metadata"] == nil {
			t.Fatalf("expected metadata in body")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id": 2, "title": "T"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	thread, err := client.CreateThread(context.Background(), &CreateThreadOptions{
		Title:    "T",
		Messages: []ThreadMessage{{ID: 1, Role: "user", Content: "hi"}},
		Metadata: map[string]any{"source": "test"},
	})
	if err != nil || thread.ID != 2 {
		t.Fatalf("CreateThread failed: %v", err)
	}

	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer errServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: errServer.URL})
	_, err = client.CreateThread(context.Background(), &CreateThreadOptions{Title: "x"})
	if err == nil {
		t.Fatal("expected create thread error")
	}
}

func TestClient_CreateThreadInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not-json`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.CreateThread(context.Background(), nil)
	if err == nil {
		t.Fatal("expected decode error")
	}
}

func TestClient_ListThreadsErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.ListThreads(context.Background(), 1, 0)
	if err == nil {
		t.Fatal("expected list threads error")
	}
}

func TestClient_ListThreadsInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.ListThreads(context.Background(), 1, 0)
	if err == nil {
		t.Fatal("expected decode error")
	}
}

func TestClient_GetThreadError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetThread(context.Background(), 99)
	if err == nil {
		t.Fatal("expected get thread error")
	}
}

func TestClient_GetThreadInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetThread(context.Background(), 1)
	if err == nil {
		t.Fatal("expected decode error")
	}
}

func TestClient_GetThreadMessagesError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetThreadMessages(context.Background(), 1, 10, 0)
	if err == nil {
		t.Fatal("expected get messages error")
	}
}

func TestClient_GetThreadMessagesInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not-json`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetThreadMessages(context.Background(), 1, 10, 0)
	if err == nil {
		t.Fatal("expected decode error")
	}
}

func TestClient_RunInThreadWithModelAndOptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["modelId"] != "gpt-test" || body["options"] == nil {
			t.Fatalf("unexpected body: %+v", body)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"task_id": "task-2"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	resp, err := client.RunInThread(context.Background(), 1, ThreadRunOptions{
		Prompt:  "run",
		ModelID: "gpt-test",
		Options: map[string]any{"temperature": 0.2},
	})
	if err != nil || resp.TaskID != "task-2" {
		t.Fatalf("RunInThread failed: %v", err)
	}

	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer errServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: errServer.URL})
	_, err = client.RunInThread(context.Background(), 1, ThreadRunOptions{Prompt: "run"})
	if err == nil {
		t.Fatal("expected run in thread error")
	}

	badJSON := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{`))
	}))
	defer badJSON.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: badJSON.URL})
	_, err = client.RunInThread(context.Background(), 1, ThreadRunOptions{Prompt: "run"})
	if err == nil {
		t.Fatal("expected run decode error")
	}
}
