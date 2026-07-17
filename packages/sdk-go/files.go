package taskforceai

import (
	"context"
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

	resp, err := c.sendMultipartRequest(ctx, apiRootURL(c.baseURL)+"/attachments/upload", body, contentType, "upload attachment")
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

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

	resp, err := c.sendMultipartRequest(ctx, c.baseURL+"/files", body, contentType, "upload file")
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	return decodeValidated(resp.Body, "upload file", validateFile)
}

func (c *Client) sendMultipartRequest(ctx context.Context, url string, body *io.PipeReader, contentType, operation string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
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
		return nil, fmt.Errorf("failed to %s: response unavailable", operation)
	}
	keepBodyOpen := false
	defer func() {
		if !keepBodyOpen {
			_ = resp.Body.Close()
		}
	}()
	if c.responseHook != nil {
		c.responseHook(resp.StatusCode, resp.Header)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to %s: status %d", operation, resp.StatusCode)
	}
	keepBodyOpen = true
	return resp, nil
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
	return requestDecoded(c, ctx, http.MethodGet, path, nil, "list files", http.StatusOK, "file list", validateFileList)
}

// GetFile retrieves metadata for a specific file.
func (c *Client) GetFile(ctx context.Context, fileID string) (*File, error) {
	path := "/files/" + pathSegment(fileID)
	return requestDecoded(c, ctx, http.MethodGet, path, nil, "get file", http.StatusOK, "file", validateFile)
}

// DeleteFile deletes a file by ID.
func (c *Client) DeleteFile(ctx context.Context, fileID string) error {
	path := "/files/" + pathSegment(fileID)

	resp, err := c.requestSuccessful(ctx, "DELETE", path, nil, "delete file", 0)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	return nil
}

// DownloadFile downloads the content of a file.
func (c *Client) DownloadFile(ctx context.Context, fileID string) (io.ReadCloser, error) {
	path := "/files/" + pathSegment(fileID) + "/content"

	resp, err := c.requestSuccessful(ctx, "GET", path, nil, "download file", http.StatusOK)
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}
