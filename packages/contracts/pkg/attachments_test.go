package pkg

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var benchmarkFormDataSize int

type stubAttachmentFile struct {
	data     []byte
	readErr  error
	closeErr error
	read     bool
}

func (f *stubAttachmentFile) Read(p []byte) (int, error) {
	if f.readErr != nil {
		return 0, f.readErr
	}
	if f.read {
		return 0, io.EOF
	}
	f.read = true
	return copy(p, f.data), nil
}

func (f *stubAttachmentFile) Close() error {
	return f.closeErr
}

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

func BenchmarkBuildRunFormDataPromptOnly(b *testing.B) {
	request := RunRequest{Prompt: "summarize the project status"}

	b.ReportAllocs()
	for b.Loop() {
		body, contentType, err := BuildRunFormData(request, nil)
		if err != nil {
			b.Fatal(err)
		}
		benchmarkFormDataSize += len(contentType)
		if sized, ok := body.(interface{ Len() int }); ok {
			benchmarkFormDataSize += sized.Len()
		}
	}
}

func BenchmarkBuildRunFormDataFullWithAttachments(b *testing.B) {
	tmpDir := b.TempDir()
	filePath := filepath.Join(tmpDir, "attachment.txt")
	content := strings.Repeat("taskforce attachment payload\n", 256)
	if err := os.WriteFile(filePath, []byte(content), 0o600); err != nil {
		b.Fatal(err)
	}

	budget := 12.5
	request := RunRequest{
		Prompt:         strings.Repeat("research prompt ", 64),
		ConversationID: "conv-123",
		ProjectID:      7,
		ModelID:        "gpt-4.1",
		Demo:           true,
		AttachmentIDs:  []string{"u:1:att-1", "u:1:att-2"},
		Budget:         &budget,
		RoleModels: map[string]string{
			"research": "gpt-4.1",
			"review":   "gpt-4.1-mini",
		},
		Options: map[string]any{
			"quickModeEnabled": true,
			"maxSteps":         8,
		},
	}
	attachments := []RunTaskAttachment{
		{URI: filePath, Name: "attachment-a.txt", Type: "text/plain"},
		{URI: filePath, Name: "attachment-b.txt", Type: "text/plain"},
	}

	b.ReportAllocs()
	b.SetBytes(int64(len(content) * len(attachments)))
	for b.Loop() {
		body, contentType, err := BuildRunFormData(request, attachments)
		if err != nil {
			b.Fatal(err)
		}
		benchmarkFormDataSize += len(contentType)
		if sized, ok := body.(interface{ Len() int }); ok {
			benchmarkFormDataSize += sized.Len()
		}
	}
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

func TestBuildRunFormData_JSONEncodeError(t *testing.T) {
	_, _, err := BuildRunFormData(RunRequest{
		Prompt:  "test",
		Options: map[string]any{"bad": func() {}},
	}, nil)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to encode options field")
}

func TestBuildRunFormData_AttachmentStreamAndCloseErrors(t *testing.T) {
	originalOpenAttachmentFile := openAttachmentFile
	t.Cleanup(func() {
		openAttachmentFile = originalOpenAttachmentFile
	})

	tests := []struct {
		name      string
		file      *stubAttachmentFile
		wantError string
	}{
		{
			name: "copy error",
			file: &stubAttachmentFile{
				readErr: errors.New("read failed"),
			},
			wantError: `failed to stream attachment "file.txt": read failed`,
		},
		{
			name: "copy and close error",
			file: &stubAttachmentFile{
				readErr:  errors.New("read failed"),
				closeErr: errors.New("close failed"),
			},
			wantError: `also failed to close file: close failed`,
		},
		{
			name: "close error after copy",
			file: &stubAttachmentFile{
				data:     []byte("content"),
				closeErr: errors.New("close failed"),
			},
			wantError: `failed to close attachment "file.txt": close failed`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			openAttachmentFile = func(string) (attachmentReadCloser, error) {
				return tt.file, nil
			}

			_, _, err := BuildRunFormData(RunRequest{Prompt: "test"}, []RunTaskAttachment{
				{URI: "file.txt", Name: "file.txt", Type: "text/plain"},
			})

			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantError)
		})
	}
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

func TestResolveAttachmentPathWindowsAndUnescapeErrors(t *testing.T) {
	got, err := resolveAttachmentPathForGOOS("file:///C:/Users/Alice/file.txt", "windows")
	require.NoError(t, err)
	assert.Equal(t, `C:\Users\Alice\file.txt`, got)

	got, err = resolveAttachmentPathForGOOS("file://fileserver/share/file.txt", "windows")
	require.NoError(t, err)
	assert.Equal(t, `\\fileserver\share\file.txt`, got)

	originalPathUnescape := pathUnescape
	t.Cleanup(func() {
		pathUnescape = originalPathUnescape
	})
	pathUnescape = func(string) (string, error) {
		return "", errors.New("decode failed")
	}

	_, err = resolveAttachmentPath("file:///tmp/file.txt")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid file URI path")
}

func TestOpenAttachmentPathEdges(t *testing.T) {
	_, err := openAttachment("/")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachment path must reference a file")

	_, err = openAttachment("missing-relative-file.txt")
	require.Error(t, err)
}

func TestAttachmentFilenameAndContentTypeEdges(t *testing.T) {
	assert.False(t, isSimpleMultipartFilename(""))
	assert.False(t, isSimpleMultipartFilename("white space.txt"))
	assert.False(t, isSimpleMultipartFilename("quoted\"name.txt"))
	assert.False(t, isSimpleMultipartFilename("semi;colon.txt"))
	assert.True(t, isSimpleMultipartFilename("safe-name.txt"))

	assert.Equal(t, "application/octet-stream", normalizeAttachmentContentType("text/plain; bad=\x00"))
	assert.False(t, isSimpleNormalizedMediaType("textplain"))
	assert.False(t, isSimpleNormalizedMediaType("/plain"))
	assert.False(t, isSimpleNormalizedMediaType("text/"))
	assert.False(t, isSimpleNormalizedMediaType("text/plain/json"))
	assert.True(t, isSimpleNormalizedMediaType("application/ld+json"))
	assert.Equal(t, "textplain", normalizeAttachmentContentType("textplain"))
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
