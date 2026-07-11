package taskforceai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

type multipartFormWriter interface {
	CreateFormFile(fieldname, filename string) (io.Writer, error)
	WriteField(fieldname, value string) error
	Close() error
	FormDataContentType() string
}

var newMultipartUploadWriter = func(w io.Writer) multipartFormWriter {
	return multipart.NewWriter(w)
}

type multipartUploadField struct {
	Name       string
	Value      string
	WriteError string
}

type multipartUploadBodyOptions struct {
	Filename         string
	Content          io.Reader
	CreateFileError  string
	CopyContentError string
	CloseWriterError string
	Fields           []multipartUploadField
}

func newMultipartUploadBody(opts multipartUploadBodyOptions) (*io.PipeReader, string) {
	pr, pw := io.Pipe()
	writer := newMultipartUploadWriter(pw)

	go func() {
		var closeErr error
		defer func() {
			if closeErr != nil {
				_ = pw.CloseWithError(closeErr)
				return
			}
			_ = pw.Close()
		}()

		part, err := writer.CreateFormFile("file", opts.Filename)
		if err != nil {
			closeErr = fmt.Errorf("%s: %w", opts.CreateFileError, err)
			return
		}
		if _, err := io.Copy(part, opts.Content); err != nil {
			closeErr = fmt.Errorf("%s: %w", opts.CopyContentError, err)
			return
		}
		for _, field := range opts.Fields {
			if field.Value == "" {
				continue
			}
			if err := writer.WriteField(field.Name, field.Value); err != nil {
				closeErr = fmt.Errorf("%s: %w", field.WriteError, err)
				return
			}
		}
		if err := writer.Close(); err != nil {
			closeErr = fmt.Errorf("%s: %w", opts.CloseWriterError, err)
		}
	}()

	return pr, writer.FormDataContentType()
}

// File represents an uploaded file.
type File struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	Purpose   string `json:"purpose"`
	Bytes     int64  `json:"bytes"`
	CreatedAt int64  `json:"created_at"` // Unix timestamp in seconds.
	MimeType  string `json:"mime_type,omitempty"`
}

// FileUploadOptions contains options for uploading a file.
type FileUploadOptions struct {
	Purpose  string `json:"purpose,omitempty"` // e.g., "assistants", "fine-tune"
	MimeType string `json:"mime_type,omitempty"`
}

// FileListResponse contains a list of files.
type FileListResponse struct {
	Files []File `json:"files"`
	Total int    `json:"total"`
}

// UploadAttachment uploads a transient task attachment and returns its attachment ID.
func (c *Client) UploadAttachment(ctx context.Context, filename string, content io.Reader, mimeType string) (string, error) {
	body, contentType := newMultipartUploadBody(multipartUploadBodyOptions{
		Filename:         filename,
		Content:          content,
		CreateFileError:  "create attachment file part",
		CopyContentError: "copy attachment content",
		CloseWriterError: "close attachment multipart writer",
		Fields: []multipartUploadField{{
			Name:       "mime_type",
			Value:      mimeType,
			WriteError: "write attachment mime_type field",
		}},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", taskAttachmentBaseURL(c.baseURL)+"/attachments/upload", body)
	if err != nil {
		_ = body.CloseWithError(err)
		return "", err
	}
	req.Header.Set("Content-Type", contentType)
	c.addRequestMetadata(ctx, req)

	resp, err := c.uploadRequest(req)
	if err != nil {
		return "", err
	}
	if resp == nil {
		return "", fmt.Errorf("failed to upload attachment: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if c.responseHook != nil {
		c.responseHook(resp.StatusCode, resp.Header)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("failed to upload attachment: status %d", resp.StatusCode)
	}

	var result struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(resp.Body, &result); err != nil {
		return "", err
	}
	if result.ID == "" {
		return "", fmt.Errorf("invalid attachment upload response: id is required")
	}
	return result.ID, nil
}

// UploadFile uploads a file to the API.
func (c *Client) UploadFile(ctx context.Context, filename string, content io.Reader, opts *FileUploadOptions) (*File, error) {
	fields := make([]multipartUploadField, 0, 2)
	if opts != nil {
		fields = append(fields,
			multipartUploadField{
				Name:       "purpose",
				Value:      opts.Purpose,
				WriteError: "write upload purpose field",
			},
			multipartUploadField{
				Name:       "mime_type",
				Value:      opts.MimeType,
				WriteError: "write upload mime_type field",
			},
		)
	}
	body, contentType := newMultipartUploadBody(multipartUploadBodyOptions{
		Filename:         filename,
		Content:          content,
		CreateFileError:  "create upload file part",
		CopyContentError: "copy upload file content",
		CloseWriterError: "close upload multipart writer",
		Fields:           fields,
	})

	url := c.baseURL + "/files"
	req, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		_ = body.CloseWithError(err)
		return nil, err
	}

	req.Header.Set("Content-Type", contentType)
	c.addRequestMetadata(ctx, req)

	resp, err := c.uploadRequest(req)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to upload file: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if c.responseHook != nil {
		c.responseHook(resp.StatusCode, resp.Header)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to upload file: status %d", resp.StatusCode)
	}

	var file File
	if err := json.NewDecoder(resp.Body).Decode(&file); err != nil {
		return nil, err
	}
	if err := validateFile(file, "upload file"); err != nil {
		return nil, err
	}

	return &file, nil
}

func (c *Client) uploadRequest(req *http.Request) (*http.Response, error) {
	if c.uploadRequestHook != nil {
		return c.uploadRequestHook(req)
	}
	return c.httpClient.Do(req)
}

// ListFiles retrieves a list of uploaded files.
func (c *Client) ListFiles(ctx context.Context, limit, offset int) (*FileListResponse, error) {
	path := fmt.Sprintf("/files?limit=%d&offset=%d", limit, offset)

	resp, err := c.request(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to list files: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to list files: status %d", resp.StatusCode)
	}

	var result FileListResponse
	if err := decodeJSON(resp.Body, &result); err != nil {
		return nil, err
	}
	if err := validateFileList(result, "file list"); err != nil {
		return nil, err
	}

	return &result, nil
}

// GetFile retrieves metadata for a specific file.
func (c *Client) GetFile(ctx context.Context, fileID string) (*File, error) {
	path := "/files/" + pathSegment(fileID)

	resp, err := c.request(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to get file: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to get file: status %d", resp.StatusCode)
	}

	var file File
	if err := decodeJSON(resp.Body, &file); err != nil {
		return nil, err
	}
	if err := validateFile(file, "file"); err != nil {
		return nil, err
	}

	return &file, nil
}

// DeleteFile deletes a file by ID.
func (c *Client) DeleteFile(ctx context.Context, fileID string) error {
	path := "/files/" + pathSegment(fileID)

	resp, err := c.request(ctx, "DELETE", path, nil)
	if err != nil {
		return err
	}
	if resp == nil {
		return fmt.Errorf("failed to delete file: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("failed to delete file: status %d", resp.StatusCode)
	}

	return nil
}

// DownloadFile downloads the content of a file.
func (c *Client) DownloadFile(ctx context.Context, fileID string) (io.ReadCloser, error) {
	path := "/files/" + pathSegment(fileID) + "/content"

	resp, err := c.request(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to download file: response unavailable")
	}

	if resp.StatusCode != 200 {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("failed to download file: status %d", resp.StatusCode)
	}

	return resp.Body, nil
}

// Helper function to decode JSON responses
func decodeJSON(r io.Reader, v any) error {
	return json.NewDecoder(r).Decode(v)
}
