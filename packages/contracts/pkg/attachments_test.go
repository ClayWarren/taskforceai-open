package pkg

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/textproto"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildRunFormData(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test-attachment-*.txt")
	require.NoError(t, err)
	defer func() { _ = os.Remove(tmpFile.Name()) }()
	_, err = tmpFile.WriteString("attachment content")
	assert.NoError(t, err)
	assert.NoError(t, tmpFile.Close())

	attachments := []RunTaskAttachment{
		{URI: tmpFile.Name(), Name: "file1.txt", Type: "text/plain"},
	}

	budget := 12.5
	request := RunRequest{
		Prompt:         "test prompt",
		ConversationID: "conv-123",
		ProjectID:      7,
		ModelID:        "gpt-4",
		Demo:           true,
		AttachmentIDs:  []string{"u:1:att-1"},
		Budget:         &budget,
		RoleModels:     map[string]string{"research": "gpt-4.1"},
		Options:        map[string]any{"quickModeEnabled": true},
	}
	body, contentType, err := BuildRunFormData(request, attachments)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(contentType, "multipart/form-data"))

	// Parse it back
	reader := multipart.NewReader(body, strings.TrimPrefix(contentType, "multipart/form-data; boundary="))

	form, err := reader.ReadForm(1024 * 1024)
	require.NoError(t, err)

	assert.Equal(t, request.Prompt, form.Value["prompt"][0])
	assert.Equal(t, request.ConversationID, form.Value["conversation_id"][0])
	assert.Equal(t, request.ModelID, form.Value["modelId"][0])
	assert.Equal(t, "7", form.Value["projectId"][0])
	assert.Equal(t, "true", form.Value["demo"][0])
	assert.Equal(t, "12.5", form.Value["budget"][0])
	assert.JSONEq(t, `{"research":"gpt-4.1"}`, form.Value["role_models"][0])
	assert.JSONEq(t, `["u:1:att-1"]`, form.Value["attachment_ids"][0])
	assert.JSONEq(t, `{"quickModeEnabled":true}`, form.Value["options"][0])

	assert.Len(t, form.File["files"], 1)
	assert.Equal(t, "file1.txt", form.File["files"][0].Filename)
	assert.Equal(t, "text/plain", form.File["files"][0].Header.Get("Content-Type"))

	f, err := form.File["files"][0].Open()
	require.NoError(t, err)
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(f)
	require.NoError(t, err)
	assert.Equal(t, "attachment content", string(b))
}

func TestBuildRunFormData_NoOptionalFields(t *testing.T) {
	body, contentType, err := BuildRunFormData(RunRequest{Prompt: "prompt only"}, nil)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(contentType, "multipart/form-data"))

	reader := multipart.NewReader(body, strings.TrimPrefix(contentType, "multipart/form-data; boundary="))
	form, err := reader.ReadForm(1024 * 1024)
	require.NoError(t, err)

	assert.Equal(t, "prompt only", form.Value["prompt"][0])
	assert.Empty(t, form.Value["conversation_id"])
	assert.Empty(t, form.Value["modelId"])
	assert.Empty(t, form.Value["projectId"])
	assert.Empty(t, form.Value["demo"])
	assert.Empty(t, form.Value["budget"])
	assert.Empty(t, form.Value["role_models"])
	assert.Empty(t, form.Value["attachment_ids"])
	assert.Empty(t, form.Value["options"])
}

func TestBuildRunFormData_RealFile(t *testing.T) {
	// Create a temp file to test the real file path
	tmpFile, err := os.CreateTemp("", "test-attachment-*.txt")
	require.NoError(t, err)
	defer func() { _ = os.Remove(tmpFile.Name()) }()

	_, err = tmpFile.WriteString("real file content")
	require.NoError(t, err)
	_ = tmpFile.Close()

	attachments := []RunTaskAttachment{
		{URI: tmpFile.Name(), Name: "realfile.txt", Type: ""},
	}

	body, contentType, err := BuildRunFormData(RunRequest{Prompt: "test"}, attachments)
	require.NoError(t, err)

	reader := multipart.NewReader(body, strings.TrimPrefix(contentType, "multipart/form-data; boundary="))
	form, err := reader.ReadForm(1024 * 1024)
	require.NoError(t, err)

	assert.Len(t, form.File["files"], 1)
	f, err := form.File["files"][0].Open()
	require.NoError(t, err)
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(f)
	require.NoError(t, err)
	assert.Equal(t, "real file content", string(b))
}

func TestBuildRunFormData_FileURI(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test-attachment-uri-*.txt")
	require.NoError(t, err)
	defer func() { _ = os.Remove(tmpFile.Name()) }()

	_, err = tmpFile.WriteString("file uri content")
	assert.NoError(t, err)
	assert.NoError(t, tmpFile.Close())

	attachments := []RunTaskAttachment{
		{
			URI:  (&url.URL{Scheme: "file", Path: tmpFile.Name()}).String(),
			Name: "file-uri.txt",
			Type: "text/plain",
		},
	}

	body, contentType, err := BuildRunFormData(RunRequest{Prompt: "test"}, attachments)
	require.NoError(t, err)

	reader := multipart.NewReader(body, strings.TrimPrefix(contentType, "multipart/form-data; boundary="))
	form, err := reader.ReadForm(1024 * 1024)
	require.NoError(t, err)
	assert.Len(t, form.File["files"], 1)

	f, err := form.File["files"][0].Open()
	require.NoError(t, err)
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(f)
	require.NoError(t, err)
	assert.Equal(t, "file uri content", string(b))
}

func TestBuildRunFormData_AttachmentOpenFailure(t *testing.T) {
	attachments := []RunTaskAttachment{
		{URI: "/this/path/does/not/exist.txt", Name: "missing.txt", Type: "text/plain"},
	}

	_, _, err := BuildRunFormData(RunRequest{Prompt: "test"}, attachments)
	require.Error(t, err)
	assert.Contains(t, err.Error(), `failed to open attachment "missing.txt"`)
}

func TestBuildRunFormData_AttachmentResolveFailure(t *testing.T) {
	attachments := []RunTaskAttachment{
		{URI: "file://fileserver/tmp/file.txt", Name: "remote.txt", Type: "text/plain"},
	}

	_, _, err := BuildRunFormData(RunRequest{Prompt: "test"}, attachments)
	require.Error(t, err)
	assert.Contains(t, err.Error(), `failed to resolve attachment "remote.txt"`)
}

func TestBuildRunFormData_SanitizesAttachmentHeaders(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test-attachment-*.txt")
	require.NoError(t, err)
	defer func() { _ = os.Remove(tmpFile.Name()) }()

	_, err = tmpFile.WriteString("header-safe-content")
	assert.NoError(t, err)
	assert.NoError(t, tmpFile.Close())

	attachments := []RunTaskAttachment{
		{
			URI:  tmpFile.Name(),
			Name: "safe\" \r\nX-Injected: yes\r\n\".txt",
			Type: "text/plain\r\nX-Type: injected",
		},
	}

	body, contentType, err := BuildRunFormData(RunRequest{Prompt: "prompt"}, attachments)
	require.NoError(t, err)

	reader := multipart.NewReader(body, strings.TrimPrefix(contentType, "multipart/form-data; boundary="))
	form, err := reader.ReadForm(1024 * 1024)
	require.NoError(t, err)
	assert.Len(t, form.File["files"], 1)

	fileHeader := form.File["files"][0].Header
	assert.Empty(t, fileHeader.Get("X-Injected"))
	assert.Empty(t, fileHeader.Get("X-Type"))
	assert.Equal(t, "application/octet-stream", fileHeader.Get("Content-Type"))
}

// MockFormDataWriter is a mock implementation of FormDataWriter for testing
type MockFormDataWriter struct {
	createPartError bool
	closeError      bool
	writeFieldError string
	realWriter      *multipart.Writer
}

func (m *MockFormDataWriter) WriteField(fieldname, value string) error {
	if m.writeFieldError == fieldname {
		return errors.New("write field error")
	}
	return m.realWriter.WriteField(fieldname, value)
}

func (m *MockFormDataWriter) CreatePart(header textproto.MIMEHeader) (io.Writer, error) {
	if m.createPartError {
		return nil, errors.New("create part error")
	}
	return m.realWriter.CreatePart(header)
}

func (m *MockFormDataWriter) Close() error {
	if m.closeError {
		return errors.New("close error")
	}
	return m.realWriter.Close()
}

func (m *MockFormDataWriter) FormDataContentType() string {
	return m.realWriter.FormDataContentType()
}

func TestBuildRunFormData_CreatePartError(t *testing.T) {
	// Save original and restore after test
	originalNewWriter := newFormDataWriter
	defer func() { newFormDataWriter = originalNewWriter }()

	// Override with mock that fails on CreatePart
	newFormDataWriter = func(w io.Writer) FormDataWriter {
		return &MockFormDataWriter{
			createPartError: true,
			realWriter:      multipart.NewWriter(w),
		}
	}

	attachments := []RunTaskAttachment{
		{URI: "test", Name: "file.txt", Type: "text/plain"},
	}

	_, _, err := BuildRunFormData(RunRequest{Prompt: "test"}, attachments)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create part error")
}

func TestBuildRunFormData_CloseError(t *testing.T) {
	// Save original and restore after test
	originalNewWriter := newFormDataWriter
	defer func() { newFormDataWriter = originalNewWriter }()

	// Track if we need to use a real buffer
	var buf bytes.Buffer

	// Override with mock that fails on Close
	newFormDataWriter = func(w io.Writer) FormDataWriter {
		return &MockFormDataWriter{
			closeError: true,
			realWriter: multipart.NewWriter(&buf),
		}
	}

	_, _, err := BuildRunFormData(RunRequest{Prompt: "test"}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "close error")
}

func TestBuildRunFormData_WriteFieldErrors(t *testing.T) {
	originalNewWriter := newFormDataWriter
	defer func() { newFormDataWriter = originalNewWriter }()

	tests := []struct {
		field string
		call  func() error
		want  string
	}{
		{
			field: "prompt",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt"}, nil)
				return err
			},
			want: "failed to write prompt field",
		},
		{
			field: "conversation_id",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", ConversationID: "conv-123"}, nil)
				return err
			},
			want: "failed to write conversation_id field",
		},
		{
			field: "modelId",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", ModelID: "gpt-4"}, nil)
				return err
			},
			want: "failed to write modelId field",
		},
		{
			field: "projectId",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", ProjectID: 7}, nil)
				return err
			},
			want: "failed to write projectId field",
		},
		{
			field: "demo",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", Demo: true}, nil)
				return err
			},
			want: "failed to write demo field",
		},
		{
			field: "budget",
			call: func() error {
				budget := 12.5
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", Budget: &budget}, nil)
				return err
			},
			want: "failed to write budget field",
		},
		{
			field: "role_models",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", RoleModels: map[string]string{"research": "gpt-4"}}, nil)
				return err
			},
			want: "failed to write role_models field",
		},
		{
			field: "attachment_ids",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", AttachmentIDs: []string{"u:1:att-1"}}, nil)
				return err
			},
			want: "failed to write attachment_ids field",
		},
		{
			field: "options",
			call: func() error {
				_, _, err := BuildRunFormData(RunRequest{Prompt: "prompt", Options: map[string]any{"quickModeEnabled": true}}, nil)
				return err
			},
			want: "failed to write options field",
		},
	}

	for _, tt := range tests {
		t.Run(tt.field, func(t *testing.T) {
			var buf bytes.Buffer
			newFormDataWriter = func(w io.Writer) FormDataWriter {
				return &MockFormDataWriter{
					writeFieldError: tt.field,
					realWriter:      multipart.NewWriter(&buf),
				}
			}

			err := tt.call()
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.want)
		})
	}
}

func TestResolveAttachmentPath(t *testing.T) {
	tests := []struct {
		name    string
		rawURI  string
		want    string
		wantErr string
	}{
		{
			name:   "plain path trims whitespace",
			rawURI: "  /tmp/example.txt  ",
			want:   "/tmp/example.txt",
		},
		{
			name:    "empty path rejected",
			rawURI:  "  ",
			wantErr: "attachment URI is empty",
		},
		{
			name:   "file uri decodes path",
			rawURI: "file:///tmp/taskforce%20ai.txt",
			want:   "/tmp/taskforce ai.txt",
		},
		{
			name:   "localhost file uri is accepted",
			rawURI: "file://localhost/tmp/taskforce.txt",
			want:   "/tmp/taskforce.txt",
		},
		{
			name:    "file uri path must decode",
			rawURI:  "file:///tmp/%zz",
			wantErr: "invalid file URI",
		},
		{
			name:    "file uri path required",
			rawURI:  "file://localhost",
			wantErr: "file URI path is empty",
		},
		{
			name:    "remote host rejected on non windows",
			rawURI:  "file://fileserver/tmp/taskforce.txt",
			wantErr: "unsupported file URI host",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveAttachmentPath(tt.rawURI)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestNormalizeAttachmentContentType(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "empty defaults to octet stream",
			raw:  "",
			want: "application/octet-stream",
		},
		{
			name: "invalid defaults to octet stream",
			raw:  "text/plain\r\nX-Injected: yes",
			want: "application/octet-stream",
		},
		{
			name: "valid type is preserved",
			raw:  "text/plain",
			want: "text/plain",
		},
		{
			name: "valid type parameters are normalized",
			raw:  `text/plain; charset="utf-8"`,
			want: "text/plain; charset=utf-8",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, normalizeAttachmentContentType(tt.raw))
		})
	}
}
