package integrations

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type GoogleDriveClient struct {
	tokenSource oauth2.TokenSource
}

func NewGoogleDriveClient(ts oauth2.TokenSource) *GoogleDriveClient {
	return &GoogleDriveClient{tokenSource: ts}
}

type DriveService interface {
	ListFiles(ctx context.Context, query string) ([]*drive.File, error)
	GetFile(ctx context.Context, fileID string) (*drive.File, error)
	ExportFile(ctx context.Context, fileID, mimeType string) (io.ReadCloser, error)
	DownloadFile(ctx context.Context, fileID string) (io.ReadCloser, error)
}

type driveServiceAdapter struct {
	svc *drive.Service
}

var newDriveService = drive.NewService

func (d *driveServiceAdapter) ListFiles(ctx context.Context, query string) ([]*drive.File, error) {
	call := d.svc.Files.List().PageSize(10).Fields("nextPageToken, files(id, name, mimeType)")
	if query != "" {
		call = call.Q(query)
	}
	res, err := call.Context(ctx).Do()
	if err != nil {
		slog.Error("Google Drive ListFiles failed", "error", err, "query", query)
		return nil, err
	}
	return res.Files, nil
}

func (d *driveServiceAdapter) GetFile(ctx context.Context, fileID string) (*drive.File, error) {
	f, err := d.svc.Files.Get(fileID).Fields("id, name, mimeType").Context(ctx).Do()
	if err != nil {
		slog.Error("Google Drive GetFile failed", "error", err, "fileId", fileID)
		return nil, err
	}
	return f, nil
}

func (d *driveServiceAdapter) ExportFile(ctx context.Context, fileID, mimeType string) (io.ReadCloser, error) {
	resp, err := d.svc.Files.Export(fileID, mimeType).Context(ctx).Download()
	if err != nil {
		slog.Error("Google Drive ExportFile failed", "error", err, "fileId", fileID, "mimeType", mimeType)
		return nil, err
	}
	return resp.Body, nil
}

func (d *driveServiceAdapter) DownloadFile(ctx context.Context, fileID string) (io.ReadCloser, error) {
	resp, err := d.svc.Files.Get(fileID).Context(ctx).Download()
	if err != nil {
		slog.Error("Google Drive DownloadFile failed", "error", err, "fileId", fileID)
		return nil, err
	}
	return resp.Body, nil
}

var DriveServiceBuilder = func(ctx context.Context, ts oauth2.TokenSource) (DriveService, error) {
	srv, err := newDriveService(ctx, option.WithTokenSource(ts))
	if err != nil {
		return nil, err
	}
	return &driveServiceAdapter{svc: srv}, nil
}

func (c *GoogleDriveClient) ListFiles(ctx context.Context, query string) (string, error) {
	srv, err := DriveServiceBuilder(ctx, c.tokenSource)
	if err != nil {
		return "", fmt.Errorf("unable to retrieve Drive client: %w", err)
	}

	if query != "" {
		// Bug 19: Robust query sanitization
		escaped := strings.ReplaceAll(query, "\\", "\\\\")
		escaped = strings.ReplaceAll(escaped, "'", "\\'")
		query = fmt.Sprintf("name contains '%s' and trashed = false", escaped)
	}

	files, err := srv.ListFiles(ctx, query)
	if err != nil {
		return "", fmt.Errorf("unable to retrieve files: %w", err)
	}

	if len(files) == 0 {
		return "No files found.", nil
	}

	var res strings.Builder
	res.WriteString("Files found in Google Drive:\n")
	for _, i := range files {
		fmt.Fprintf(&res, "- %s (ID: %s, Type: %s)\n", i.Name, i.Id, i.MimeType)
	}

	return res.String(), nil
}

func (c *GoogleDriveClient) ReadFile(ctx context.Context, fileID string) (string, error) {
	srv, err := DriveServiceBuilder(ctx, c.tokenSource)
	if err != nil {
		return "", fmt.Errorf("unable to retrieve Drive client: %w", err)
	}

	// 1. Get Metadata
	f, err := srv.GetFile(ctx, fileID)
	if err != nil {
		return "", fmt.Errorf("unable to retrieve file metadata: %w", err)
	}

	// 2. Download content
	var body io.ReadCloser
	if strings.Contains(f.MimeType, "google-apps") {
		// Export Google Docs/Sheets
		exportMime := "text/plain"
		if strings.Contains(f.MimeType, "spreadsheet") {
			exportMime = "text/csv"
		}
		body, err = srv.ExportFile(ctx, fileID, exportMime)
		if err != nil {
			return "", fmt.Errorf("unable to export file: %w", err)
		}
	} else {
		body, err = srv.DownloadFile(ctx, fileID)
		if err != nil {
			return "", fmt.Errorf("unable to download file: %w", err)
		}
	}
	defer func() { _ = body.Close() }()

	const limit = 1024 * 100
	contents, err := io.ReadAll(io.LimitReader(body, limit+1)) // Read one extra byte to detect truncation
	if err != nil {
		return "", fmt.Errorf("unable to read file content: %w", err)
	}

	res := string(contents)
	if len(contents) > limit {
		res = string(contents[:limit]) + "\n\n[CONTENT TRUNCATED DUE TO 100KB LIMIT]"
	}

	return fmt.Sprintf("Content of file '%s':\n\n%s", f.Name, res), nil
}
