package pkg

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

//

type RunTaskAttachment struct {
	URI  string `json:"uri"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

// FormDataWriter is an interface for multipart form writing, allowing for test mocking.
type FormDataWriter interface {
	WriteField(fieldname, value string) error
	CreatePart(header textproto.MIMEHeader) (io.Writer, error)
	Close() error
	FormDataContentType() string
}

// newFormDataWriter is the function used to create form data writers. Can be overridden in tests.
var newFormDataWriter = func(w io.Writer) FormDataWriter {
	return multipart.NewWriter(w)
}

func BuildRunFormData(request RunRequest, attachments []RunTaskAttachment) (io.Reader, string, error) {
	body := &bytes.Buffer{}
	writer := newFormDataWriter(body)

	if err := writer.WriteField("prompt", request.Prompt); err != nil {
		return nil, "", fmt.Errorf("failed to write prompt field: %w", err)
	}
	if request.ConversationID != "" {
		if err := writer.WriteField("conversation_id", request.ConversationID); err != nil {
			return nil, "", fmt.Errorf("failed to write conversation_id field: %w", err)
		}
	}
	if request.ModelID != "" {
		if err := writer.WriteField("modelId", request.ModelID); err != nil {
			return nil, "", fmt.Errorf("failed to write modelId field: %w", err)
		}
	}
	if request.ProjectID != 0 {
		if err := writer.WriteField("projectId", fmt.Sprintf("%d", request.ProjectID)); err != nil {
			return nil, "", fmt.Errorf("failed to write projectId field: %w", err)
		}
	}
	if request.Demo {
		if err := writer.WriteField("demo", fmt.Sprintf("%v", request.Demo)); err != nil {
			return nil, "", fmt.Errorf("failed to write demo field: %w", err)
		}
	}
	if request.Budget != nil {
		if err := writer.WriteField("budget", fmt.Sprintf("%v", *request.Budget)); err != nil {
			return nil, "", fmt.Errorf("failed to write budget field: %w", err)
		}
	}
	if request.RoleModels != nil {
		if err := writeJSONFormField(writer, "role_models", request.RoleModels); err != nil {
			return nil, "", err
		}
	}
	if request.AttachmentIDs != nil {
		if err := writeJSONFormField(writer, "attachment_ids", request.AttachmentIDs); err != nil {
			return nil, "", err
		}
	}
	if request.Options != nil {
		if err := writeJSONFormField(writer, "options", request.Options); err != nil {
			return nil, "", err
		}
	}

	for _, a := range attachments {
		h := make(textproto.MIMEHeader)
		contentDisposition := mime.FormatMediaType("form-data", map[string]string{
			"name":     "files",
			"filename": a.Name,
		})
		if contentDisposition == "" {
			return nil, "", fmt.Errorf("failed to encode attachment filename %q", a.Name)
		}
		h.Set("Content-Disposition", contentDisposition)

		contentType := normalizeAttachmentContentType(a.Type)
		h.Set("Content-Type", contentType)

		part, err := writer.CreatePart(h)
		if err != nil {
			return nil, "", err
		}

		attachmentPath, pathErr := resolveAttachmentPath(a.URI)
		if pathErr != nil {
			return nil, "", fmt.Errorf("failed to resolve attachment %q (%s): %w", a.Name, a.URI, pathErr)
		}

		file, err := openAttachment(attachmentPath)
		if err != nil {
			return nil, "", fmt.Errorf("failed to open attachment %q (%s): %w", a.Name, a.URI, err)
		}

		if _, copyErr := io.Copy(part, file); copyErr != nil {
			if closeErr := file.Close(); closeErr != nil {
				return nil, "", fmt.Errorf("failed to stream attachment %q: %w (also failed to close file: %w)", a.Name, copyErr, closeErr)
			}
			return nil, "", fmt.Errorf("failed to stream attachment %q: %w", a.Name, copyErr)
		}
		if closeErr := file.Close(); closeErr != nil {
			return nil, "", fmt.Errorf("failed to close attachment %q: %w", a.Name, closeErr)
		}
	}

	err := writer.Close()
	if err != nil {
		return nil, "", err
	}

	return body, writer.FormDataContentType(), nil
}

func writeJSONFormField(writer FormDataWriter, fieldname string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to encode %s field: %w", fieldname, err)
	}
	if err := writer.WriteField(fieldname, string(data)); err != nil {
		return fmt.Errorf("failed to write %s field: %w", fieldname, err)
	}
	return nil
}

func openAttachment(path string) (*os.File, error) {
	cleanPath := filepath.Clean(path)
	dir, name := filepath.Split(cleanPath)
	if name == "" {
		return nil, fmt.Errorf("attachment path must reference a file")
	}
	if dir == "" {
		dir = "."
	}

	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	return root.Open(name)
}

func normalizeAttachmentContentType(raw string) string {
	if raw == "" {
		return "application/octet-stream"
	}
	mediaType, params, err := mime.ParseMediaType(raw)
	if err != nil {
		return "application/octet-stream"
	}
	if normalized := mime.FormatMediaType(mediaType, params); normalized != "" {
		return normalized
	}
	return "application/octet-stream"
}

func resolveAttachmentPath(rawURI string) (string, error) {
	trimmed := strings.TrimSpace(rawURI)
	if trimmed == "" {
		return "", fmt.Errorf("attachment URI is empty")
	}
	if !strings.HasPrefix(strings.ToLower(trimmed), "file://") {
		return trimmed, nil
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid file URI: %w", err)
	}

	decodedPath, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", fmt.Errorf("invalid file URI path: %w", err)
	}
	if decodedPath == "" {
		return "", fmt.Errorf("file URI path is empty")
	}

	if runtime.GOOS == "windows" {
		if len(decodedPath) >= 3 && decodedPath[0] == '/' && decodedPath[2] == ':' {
			decodedPath = decodedPath[1:]
		}
		if parsed.Host != "" && !strings.EqualFold(parsed.Host, "localhost") {
			return `\\` + parsed.Host + strings.ReplaceAll(decodedPath, "/", `\`), nil
		}
		return strings.ReplaceAll(decodedPath, "/", `\`), nil
	}

	if parsed.Host != "" && !strings.EqualFold(parsed.Host, "localhost") {
		return "", fmt.Errorf("unsupported file URI host %q", parsed.Host)
	}
	return decodedPath, nil
}
