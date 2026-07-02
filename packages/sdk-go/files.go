package taskforceai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
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

// File represents an uploaded file.
type File struct {
	ID        string    `json:"id"`
	Filename  string    `json:"filename"`
	Purpose   string    `json:"purpose"`
	Bytes     int64     `json:"bytes"`
	CreatedAt time.Time `json:"created_at"`
	MimeType  string    `json:"mime_type,omitempty"`
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

// UploadFile uploads a file to the API.
func (c *Client) UploadFile(ctx context.Context, filename string, content io.Reader, opts *FileUploadOptions) (*File, error) {
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

		part, err := writer.CreateFormFile("file", filename)
		if err != nil {
			closeErr = fmt.Errorf("create upload file part: %w", err)
			return
		}

		if _, err := io.Copy(part, content); err != nil {
			closeErr = fmt.Errorf("copy upload file content: %w", err)
			return
		}

		if opts != nil && opts.Purpose != "" {
			if err := writer.WriteField("purpose", opts.Purpose); err != nil {
				closeErr = fmt.Errorf("write upload purpose field: %w", err)
				return
			}
		}
		if opts != nil && opts.MimeType != "" {
			if err := writer.WriteField("mime_type", opts.MimeType); err != nil {
				closeErr = fmt.Errorf("write upload mime_type field: %w", err)
				return
			}
		}

		if err := writer.Close(); err != nil {
			closeErr = fmt.Errorf("close upload multipart writer: %w", err)
		}
	}()

	url := c.baseURL + "/files"
	req, err := http.NewRequestWithContext(ctx, "POST", url, pr)
	if err != nil {
		_ = pr.CloseWithError(err)
		return nil, err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
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
