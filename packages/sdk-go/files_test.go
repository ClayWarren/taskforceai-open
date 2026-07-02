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

type fakeMultipartFormWriter struct {
	createErr  error
	purposeErr error
	mimeErr    error
	closeErr   error
}

func (f fakeMultipartFormWriter) CreateFormFile(string, string) (io.Writer, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	return io.Discard, nil
}

func (f fakeMultipartFormWriter) WriteField(name, _ string) error {
	if name == "purpose" && f.purposeErr != nil {
		return f.purposeErr
	}
	if name == "mime_type" && f.mimeErr != nil {
		return f.mimeErr
	}
	return nil
}

func (f fakeMultipartFormWriter) Close() error {
	return f.closeErr
}

func (f fakeMultipartFormWriter) FormDataContentType() string {
	return "multipart/form-data; boundary=test"
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
		_, _ = w.Write([]byte(`{"id":"file-123","filename":"test.txt","purpose":"testing","bytes":7,"created_at":"2026-01-01T00:00:00Z"}`))
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

func TestClient_UploadFileNilResponse(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
	client.uploadRequestHook = func(req *http.Request) (*http.Response, error) {
		_, _ = io.Copy(io.Discard, req.Body)
		return nil, nil
	}

	_, err := client.UploadFile(context.Background(), "test.txt", strings.NewReader("content"), nil)
	if err == nil || !strings.Contains(err.Error(), "response unavailable") {
		t.Fatalf("expected nil response error, got %v", err)
	}
}

func TestClient_UploadFileValidatesResponse(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
	client.uploadRequestHook = func(req *http.Request) (*http.Response, error) {
		_, _ = io.Copy(io.Discard, req.Body)
		return sdkTestResponse(http.StatusOK, `{"id":"file-1"}`), nil
	}

	_, err := client.UploadFile(context.Background(), "test.txt", strings.NewReader("content"), nil)
	if err == nil || !strings.Contains(err.Error(), "filename is required") {
		t.Fatalf("expected upload validation error, got %v", err)
	}
}

func TestClient_UploadFileMultipartWriterErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		writer fakeMultipartFormWriter
		opts   *FileUploadOptions
		want   string
	}{
		{
			name:   "create file part",
			writer: fakeMultipartFormWriter{createErr: errors.New("create failed")},
			want:   "create upload file part",
		},
		{
			name:   "write purpose",
			writer: fakeMultipartFormWriter{purposeErr: errors.New("purpose failed")},
			opts:   &FileUploadOptions{Purpose: "testing"},
			want:   "write upload purpose field",
		},
		{
			name:   "write mime type",
			writer: fakeMultipartFormWriter{mimeErr: errors.New("mime failed")},
			opts:   &FileUploadOptions{MimeType: "text/plain"},
			want:   "write upload mime_type field",
		},
		{
			name:   "close writer",
			writer: fakeMultipartFormWriter{closeErr: errors.New("close failed")},
			want:   "close upload multipart writer",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous := newMultipartUploadWriter
			newMultipartUploadWriter = func(io.Writer) multipartFormWriter {
				return tc.writer
			}
			t.Cleanup(func() {
				newMultipartUploadWriter = previous
			})

			client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
			client.uploadRequestHook = func(req *http.Request) (*http.Response, error) {
				_, err := io.Copy(io.Discard, req.Body)
				return nil, err
			}

			_, err := client.UploadFile(context.Background(), "test.txt", strings.NewReader("content"), tc.opts)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
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
		_, _ = w.Write([]byte(`{"files":[{"id":"file-1","filename":"test.txt","purpose":"assistants","bytes":5,"created_at":"2026-01-01T00:00:00Z"}],"total":1}`))
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

func TestClient_FileRequestHookErrorsAndNilResponses(t *testing.T) {
	cases := []struct {
		name string
		run  func(*Client) error
	}{
		{
			name: "list",
			run: func(c *Client) error {
				_, err := c.ListFiles(context.Background(), 1, 0)
				return err
			},
		},
		{
			name: "get",
			run: func(c *Client) error {
				_, err := c.GetFile(context.Background(), "file-1")
				return err
			},
		},
		{
			name: "delete",
			run: func(c *Client) error {
				return c.DeleteFile(context.Background(), "file-1")
			},
		},
		{
			name: "download",
			run: func(c *Client) error {
				reader, err := c.DownloadFile(context.Background(), "file-1")
				if reader != nil {
					_ = reader.Close()
				}
				return err
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name+"/error", func(t *testing.T) {
			boom := errors.New("request failed")
			client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
			client.requestHook = func(context.Context, string, string, any) (*http.Response, error) {
				return nil, boom
			}

			if err := tc.run(client); !errors.Is(err, boom) {
				t.Fatalf("expected request error, got %v", err)
			}
		})

		t.Run(tc.name+"/nil-response", func(t *testing.T) {
			client, _ := NewClient(TaskForceAIOptions{APIKey: "key"})
			client.requestHook = func(context.Context, string, string, any) (*http.Response, error) {
				return nil, nil
			}

			if err := tc.run(client); err == nil || !strings.Contains(err.Error(), "response unavailable") {
				t.Fatalf("expected nil response error, got %v", err)
			}
		})
	}
}

func TestClient_GetFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/files/file-1" {
			t.Errorf("expected /files/file-1, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"file-1","filename":"test.txt","purpose":"assistants","bytes":5,"created_at":"2026-01-01T00:00:00Z"}`))
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
			_, _ = w.Write([]byte(`{"id":"file/team one?","filename":"test.txt","purpose":"assistants","bytes":5,"created_at":"2026-01-01T00:00:00Z"}`))
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

func TestClient_UploadFileInvalidURL(t *testing.T) {
	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: "://bad-url"})
	_, err := client.UploadFile(context.Background(), "test.txt", strings.NewReader("content"), nil)
	if err == nil {
		t.Fatal("expected upload url error")
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
		_, _ = w.Write([]byte(`{"id":"file-2","filename":"test.txt","purpose":"testing","bytes":7,"created_at":"2026-01-01T00:00:00Z"}`))
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

func TestClient_FileResponsesValidateRequiredFields(t *testing.T) {
	listServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"files":[{"id":"file-1"}],"total":1}`))
	}))
	defer listServer.Close()

	client, _ := NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: listServer.URL})
	_, err := client.ListFiles(context.Background(), 1, 0)
	if err == nil || !strings.Contains(err.Error(), "filename is required") {
		t.Fatalf("expected file validation error, got %v", err)
	}

	getServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"file-1","filename":"test.txt"}`))
	}))
	defer getServer.Close()

	client, _ = NewClient(TaskForceAIOptions{APIKey: "key", BaseURL: getServer.URL})
	_, err = client.GetFile(context.Background(), "file-1")
	if err == nil || !strings.Contains(err.Error(), "purpose is required") {
		t.Fatalf("expected get file validation error, got %v", err)
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
