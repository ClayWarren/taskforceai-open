package taskforceai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClient_SubmitTaskValidationError(t *testing.T) {
	previous := validateSubmitTaskRequest
	validateSubmitTaskRequest = func(SubmitTaskRequest) error {
		return errors.New("invalid submission")
	}
	t.Cleanup(func() {
		validateSubmitTaskRequest = previous
	})

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
	_, err := client.SubmitTask(context.Background(), "hello", nil)
	if err == nil || !strings.Contains(err.Error(), "validation error") {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestClient_TaskRequestHookFailures(t *testing.T) {
	assertRequestFailureModes(t, []sdkClientCall{
		{
			name: "submit",
			run: func(c *Client) error {
				_, err := c.SubmitTask(context.Background(), "hello", nil)
				return err
			},
		},
		{
			name: "status",
			run: func(c *Client) error {
				_, err := c.GetTaskStatus(context.Background(), "task-1")
				return err
			},
		},
	})
}

func TestClient_SubmitTask_WithOpts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId": "task-with-opts"}`))
	}))
	client := clientForServer(t, server)
	_, err := client.SubmitTask(context.Background(), "hello", &TaskSubmissionOptions{ModelID: "test-model"})
	if err != nil {
		t.Errorf("SubmitTask with opts failed: %v", err)
	}
}

func TestClient_SubmitTask_WithAttachments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/attachments/upload":
			if err := r.ParseMultipartForm(1024); err != nil {
				t.Fatalf("parse attachment upload form: %v", err)
			}
			_, header, err := r.FormFile("file")
			if err != nil {
				t.Fatalf("expected attachment file part: %v", err)
			}
			if header.Filename != "image.png" {
				t.Fatalf("expected image filename, got %s", header.Filename)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"attachment-image-1","mime_type":"image/png","size":5}`))
		case "/run":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode run request: %v", err)
			}
			if _, ok := body["attachments"]; ok {
				t.Fatal("run request must not include inline attachments")
			}
			ids, ok := body["attachment_ids"].([]any)
			if !ok || len(ids) != 1 || ids[0] != "attachment-image-1" {
				t.Fatalf("unexpected attachment_ids: %#v", body["attachment_ids"])
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"taskId": "task-with-images"}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	client := clientForServer(t, server)
	taskID, err := client.SubmitTask(context.Background(), "hello", &TaskSubmissionOptions{
		Images: []ImageAttachment{{Data: "aGVsbG8=", MimeType: "image/png", Name: "image.png"}},
	})
	if err != nil || taskID != "task-with-images" {
		t.Fatalf("SubmitTask with attachments failed: taskID=%s err=%v", taskID, err)
	}
}

func TestClient_uploadImageAttachments_DataURIAndDefaultName(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1024); err != nil {
			t.Fatalf("parse attachment form: %v", err)
		}
		_, header, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("expected file part: %v", err)
		}
		if header.Filename != "attachment" {
			t.Errorf("expected default filename 'attachment', got %s", header.Filename)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"att-1"}`))
	}))
	client := clientForServer(t, server)
	ids, err := client.uploadImageAttachments(context.Background(), []ImageAttachment{
		// Data URI prefix is stripped at the last comma; empty name falls back
		// to the default.
		{Data: "data:image/png;base64,aGVsbG8=", MimeType: "image/png"},
	})
	if err != nil {
		t.Fatalf("uploadImageAttachments failed: %v", err)
	}
	if len(ids) != 1 || ids[0] != "att-1" {
		t.Fatalf("unexpected ids: %#v", ids)
	}
}

func TestClient_uploadImageAttachments_DecodeError(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "http://example.com"})
	_, err := client.uploadImageAttachments(context.Background(), []ImageAttachment{
		{Data: "!!!not-base64!!!", MimeType: "image/png", Name: "x.png"},
	})
	if err == nil || !strings.Contains(err.Error(), "decode image attachment") {
		t.Fatalf("expected decode error, got %v", err)
	}
}

func TestClient_SubmitTask_ImageUploadError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	client := clientForServer(t, server)
	_, err := client.SubmitTask(context.Background(), "hello", &TaskSubmissionOptions{
		Images: []ImageAttachment{{Data: "aGVsbG8=", MimeType: "image/png", Name: "img.png"}},
	})
	if err == nil || !strings.Contains(err.Error(), "upload image attachment") {
		t.Fatalf("expected image upload error to propagate, got %v", err)
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
	client := clientForServer(t, server)
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

func TestClient_TaskResponsesValidateRequiredFields(t *testing.T) {
	submitServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"processing"}`))
	}))
	defer submitServer.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: submitServer.URL})
	_, err := client.SubmitTask(context.Background(), "hello", nil)
	if err == nil || !strings.Contains(err.Error(), "taskId is required") {
		t.Fatalf("expected missing taskId validation error, got %v", err)
	}

	statusServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"taskId":"task-1","status":"unknown"}`))
	}))
	defer statusServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: statusServer.URL})
	_, err = client.GetTaskStatus(context.Background(), "task-1")
	if err == nil || !strings.Contains(err.Error(), "unsupported status") {
		t.Fatalf("expected unsupported status validation error, got %v", err)
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
	client := clientForServer(t, server)
	_, err := client.GetTaskStatus(context.Background(), "team/one task?")
	if err != nil {
		t.Fatalf("GetTaskStatus failed: %v", err)
	}
}
