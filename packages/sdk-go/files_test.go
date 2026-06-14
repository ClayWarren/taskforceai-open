package taskforceai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type errorReader struct {
	err error
}

func (e errorReader) Read([]byte) (int, error) {
	return 0, e.err
}

func TestClient_UploadFile(t *testing.T) {
	// 1. Success
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if !strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Errorf("expected multipart content type")
		}

		err := r.ParseMultipartForm(10 << 20)
		if err != nil {
			t.Fatalf("failed to parse multipart form: %v", err)
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			t.Errorf("expected file in form")
		}
		defer func() { _ = file.Close() }()

		if header.Filename != "test.txt" {
			t.Errorf("expected filename test.txt, got %s", header.Filename)
		}

		if r.FormValue("purpose") != "testing" {
			t.Errorf("expected purpose testing, got %s", r.FormValue("purpose"))
		}

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id": "file-123", "filename": "test.txt"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	file, err := client.UploadFile(context.Background(), "test.txt", strings.NewReader("content"), &FileUploadOptions{Purpose: "testing"})
	if err != nil {
		t.Fatalf("UploadFile failed: %v", err)
	}
	if file.ID != "file-123" {
		t.Errorf("expected file ID file-123, got %s", file.ID)
	}

	// 2. Error case
	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer errServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: errServer.URL})
	_, err = client.UploadFile(context.Background(), "test.txt", strings.NewReader("content"), nil)
	if err == nil {
		t.Error("expected error, got nil")
	}
}

func TestClient_ListFiles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/files" {
			t.Errorf("expected /files path, got %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("limit") != "10" || q.Get("offset") != "5" {
			t.Errorf("unexpected query params: %s", r.URL.RawQuery)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"files": [{"id": "file-1"}], "total": 1}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	resp, err := client.ListFiles(context.Background(), 10, 5)
	if err != nil {
		t.Fatalf("ListFiles failed: %v", err)
	}
	if len(resp.Files) != 1 || resp.Files[0].ID != "file-1" {
		t.Errorf("unexpected response: %+v", resp)
	}
}

func TestClient_GetFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/files/file-1" {
			t.Errorf("expected /files/file-1, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id": "file-1", "filename": "test.txt"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	file, err := client.GetFile(context.Background(), "file-1")
	if err != nil {
		t.Fatalf("GetFile failed: %v", err)
	}
	if file.Filename != "test.txt" {
		t.Errorf("expected filename test.txt, got %s", file.Filename)
	}

	// Error case
	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer errServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: errServer.URL})
	_, err = client.GetFile(context.Background(), "missing")
	if err == nil {
		t.Error("expected missing file error, got nil")
	}
}

func TestClient_DeleteFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		if r.URL.Path != "/files/file-1" {
			t.Errorf("expected /files/file-1, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	err := client.DeleteFile(context.Background(), "file-1")
	if err != nil {
		t.Errorf("DeleteFile failed: %v", err)
	}
}

func TestClient_DownloadFile(t *testing.T) {
	content := "file content data"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/files/file-1/content" {
			t.Errorf("expected /files/file-1/content, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(content))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	reader, err := client.DownloadFile(context.Background(), "file-1")
	if err != nil {
		t.Fatalf("DownloadFile failed: %v", err)
	}
	defer func() { _ = reader.Close() }()

	bytes, _ := io.ReadAll(reader)
	if string(bytes) != content {
		t.Errorf("expected content %s, got %s", content, string(bytes))
	}

	errServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer errServer.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: errServer.URL})
	_, err = client.DownloadFile(context.Background(), "file-1")
	if err == nil {
		t.Error("expected download error, got nil")
	}
}

func TestClient_FileIDPathSegmentsAreEscaped(t *testing.T) {
	seen := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen[r.Method+" "+r.URL.EscapedPath()] = true
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet && !strings.HasSuffix(r.URL.EscapedPath(), "/content") {
			_, _ = w.Write([]byte(`{"id":"file/team one?","filename":"test.txt"}`))
		}
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, _ = client.GetFile(context.Background(), "file/team one?")
	_ = client.DeleteFile(context.Background(), "file/team one?")
	reader, err := client.DownloadFile(context.Background(), "file/team one?")
	if err != nil {
		t.Fatalf("DownloadFile failed: %v", err)
	}
	_ = reader.Close()

	for _, expected := range []string{
		"GET /files/file%2Fteam%20one%3F",
		"DELETE /files/file%2Fteam%20one%3F",
		"GET /files/file%2Fteam%20one%3F/content",
	} {
		if !seen[expected] {
			t.Fatalf("missing escaped request %s in %#v", expected, seen)
		}
	}
}

func TestClient_UploadFileReaderError(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "http://example.com"})
	_, err := client.UploadFile(context.Background(), "test.txt", errorReader{err: errors.New("read failed")}, nil)
	if err == nil {
		t.Fatal("expected upload reader error")
	}
}

func TestClient_UploadFileInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.UploadFile(context.Background(), "test.txt", strings.NewReader("x"), nil)
	if err == nil {
		t.Fatal("expected upload decode error")
	}
}

func TestClient_UploadFileMimeTypeAndResponseHook(t *testing.T) {
	var hookStatus int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-SDK-Language") != "go" {
			t.Errorf("expected X-SDK-Language go, got %s", r.Header.Get("X-SDK-Language"))
		}
		if r.Header.Get("traceparent") == "" {
			t.Error("expected traceparent header")
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		if r.FormValue("mime_type") != "text/plain" {
			t.Errorf("expected mime_type text/plain")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id": "file-2"}`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{
		APIKey:       "key",
		BaseURL:      server.URL,
		ResponseHook: func(status int, _ map[string][]string) { hookStatus = status },
	})
	file, err := client.UploadFile(
		contextWithTraceParent(t),
		"test.txt",
		strings.NewReader("content"),
		&FileUploadOptions{Purpose: "testing", MimeType: "text/plain"},
	)
	if err != nil {
		t.Fatalf("UploadFile failed: %v", err)
	}
	if file.ID != "file-2" || hookStatus != http.StatusOK {
		t.Fatalf("unexpected upload result id=%s hook=%d", file.ID, hookStatus)
	}
}

func TestClient_ListFilesErrors(t *testing.T) {
	badJSON := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not-json`))
	}))
	defer badJSON.Close()
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: badJSON.URL})
	_, err := client.ListFiles(context.Background(), 1, 0)
	if err == nil {
		t.Fatal("expected decode error")
	}

	notFound := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer notFound.Close()
	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: notFound.URL})
	_, err = client.ListFiles(context.Background(), 1, 0)
	if err == nil {
		t.Fatal("expected list files status error")
	}
}

func TestClient_GetFileInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{`))
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	_, err := client.GetFile(context.Background(), "file-1")
	if err == nil {
		t.Fatal("expected decode error")
	}
}

func TestClient_DeleteFileError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: server.URL})
	if err := client.DeleteFile(context.Background(), "file-1"); err == nil {
		t.Fatal("expected delete error")
	}
}
