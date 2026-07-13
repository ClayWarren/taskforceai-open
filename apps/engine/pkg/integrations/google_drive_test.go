package integrations_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"

	intpkg "github.com/TaskForceAI/go-engine/pkg/integrations"
)

type MockTokenSource struct {
	token *oauth2.Token
	err   error
}

func (m *MockTokenSource) Token() (*oauth2.Token, error) {
	return m.token, m.err
}

type driveServiceFake struct {
	files       []*drive.File
	fileByID    map[string]*drive.File
	exports     map[string]io.ReadCloser
	downloads   map[string]io.ReadCloser
	listErr     error
	getErr      map[string]error
	exportErr   map[string]error
	downloadErr map[string]error
	queries     []string
}

func (f *driveServiceFake) ListFiles(ctx context.Context, query string) ([]*drive.File, error) {
	f.queries = append(f.queries, query)
	return f.files, f.listErr
}

func (f *driveServiceFake) GetFile(ctx context.Context, fileID string) (*drive.File, error) {
	if err := f.getErr[fileID]; err != nil {
		return nil, err
	}
	return f.fileByID[fileID], nil
}

func (f *driveServiceFake) ExportFile(ctx context.Context, fileID, mimeType string) (io.ReadCloser, error) {
	if err := f.exportErr[fileID]; err != nil {
		return nil, err
	}
	return f.exports[fileID], nil
}

func (f *driveServiceFake) DownloadFile(ctx context.Context, fileID string) (io.ReadCloser, error) {
	if err := f.downloadErr[fileID]; err != nil {
		return nil, err
	}
	return f.downloads[fileID], nil
}

func withDriveService(t *testing.T, svc intpkg.DriveService) {
	t.Helper()
	originalBuilder := intpkg.DriveServiceBuilder
	intpkg.DriveServiceBuilder = func(ctx context.Context, ts oauth2.TokenSource) (intpkg.DriveService, error) {
		return svc, nil
	}
	t.Cleanup(func() { intpkg.DriveServiceBuilder = originalBuilder })
}

func TestGoogleDriveClient_ListFiles_NoResults(t *testing.T) {
	withDriveService(t, &driveServiceFake{})

	tokenSource := &MockTokenSource{}
	client := intpkg.NewGoogleDriveClient(tokenSource)

	resp, err := client.ListFiles(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "No files found.", resp)
}

func TestGoogleDriveClient_ListFiles_WithQuery(t *testing.T) {
	fakeSvc := &driveServiceFake{files: []*drive.File{{Id: "file-1", Name: "Report", MimeType: "text/plain"}}}
	withDriveService(t, fakeSvc)

	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	resp, err := client.ListFiles(context.Background(), "report's")
	require.NoError(t, err)
	assert.Contains(t, resp, "Files found in Google Drive:")
	assert.Contains(t, resp, "Report")
	assert.Equal(t, []string{"name contains 'report\\'s' and trashed = false"}, fakeSvc.queries)
}

func TestGoogleDriveClient_ListFiles_Errors(t *testing.T) {
	originalBuilder := intpkg.DriveServiceBuilder
	defer func() { intpkg.DriveServiceBuilder = originalBuilder }()

	intpkg.DriveServiceBuilder = func(context.Context, oauth2.TokenSource) (intpkg.DriveService, error) {
		return nil, errors.New("builder failed")
	}
	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	_, err := client.ListFiles(context.Background(), "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to retrieve Drive client")

	fakeSvc := &driveServiceFake{listErr: errors.New("list failed")}
	intpkg.DriveServiceBuilder = func(context.Context, oauth2.TokenSource) (intpkg.DriveService, error) {
		return fakeSvc, nil
	}
	_, err = client.ListFiles(context.Background(), "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to retrieve files")
}

func TestGoogleDriveClient_ReadFile_GoogleDoc(t *testing.T) {
	withDriveService(t, &driveServiceFake{
		fileByID: map[string]*drive.File{"doc-1": {Id: "doc-1", Name: "Doc", MimeType: "application/vnd.google-apps.document"}},
		exports:  map[string]io.ReadCloser{"doc-1": io.NopCloser(bytes.NewBufferString("doc content"))},
	})

	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	resp, err := client.ReadFile(context.Background(), "doc-1")
	require.NoError(t, err)
	assert.Contains(t, resp, "Content of file 'Doc':")
	assert.Contains(t, resp, "doc content")
}

func TestGoogleDriveClient_ReadFile_Spreadsheet(t *testing.T) {
	withDriveService(t, &driveServiceFake{
		fileByID: map[string]*drive.File{"sheet-1": {Id: "sheet-1", Name: "Sheet", MimeType: "application/vnd.google-apps.spreadsheet"}},
		exports:  map[string]io.ReadCloser{"sheet-1": io.NopCloser(bytes.NewBufferString("a,b"))},
	})

	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	resp, err := client.ReadFile(context.Background(), "sheet-1")
	require.NoError(t, err)
	assert.Contains(t, resp, "Sheet")
	assert.Contains(t, resp, "a,b")
}

func TestGoogleDriveClient_ReadFile_Download(t *testing.T) {
	withDriveService(t, &driveServiceFake{
		fileByID:  map[string]*drive.File{"bin-1": {Id: "bin-1", Name: "Binary", MimeType: "application/octet-stream"}},
		downloads: map[string]io.ReadCloser{"bin-1": io.NopCloser(bytes.NewBufferString("bin content"))},
	})

	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	resp, err := client.ReadFile(context.Background(), "bin-1")
	require.NoError(t, err)
	assert.Contains(t, resp, "Binary")
	assert.Contains(t, resp, "bin content")
}

func TestGoogleDriveClient_ReadFile_Errors(t *testing.T) {
	originalBuilder := intpkg.DriveServiceBuilder
	defer func() { intpkg.DriveServiceBuilder = originalBuilder }()

	intpkg.DriveServiceBuilder = func(context.Context, oauth2.TokenSource) (intpkg.DriveService, error) {
		return nil, errors.New("builder failed")
	}
	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	_, err := client.ReadFile(context.Background(), "file-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to retrieve Drive client")

	fakeSvc := &driveServiceFake{
		fileByID: map[string]*drive.File{
			"export-fails":   {Id: "export-fails", Name: "Doc", MimeType: "application/vnd.google-apps.document"},
			"download-fails": {Id: "download-fails", Name: "Binary", MimeType: "application/octet-stream"},
			"read-fails":     {Id: "read-fails", Name: "Broken", MimeType: "application/octet-stream"},
		},
		getErr:      map[string]error{"missing": errors.New("metadata failed")},
		exportErr:   map[string]error{"export-fails": errors.New("export failed")},
		downloadErr: map[string]error{"download-fails": errors.New("download failed")},
		downloads:   map[string]io.ReadCloser{"read-fails": io.NopCloser(errReader{})},
	}
	intpkg.DriveServiceBuilder = func(context.Context, oauth2.TokenSource) (intpkg.DriveService, error) {
		return fakeSvc, nil
	}
	_, err = client.ReadFile(context.Background(), "missing")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to retrieve file metadata")

	_, err = client.ReadFile(context.Background(), "export-fails")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to export file")

	_, err = client.ReadFile(context.Background(), "download-fails")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to download file")

	_, err = client.ReadFile(context.Background(), "read-fails")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unable to read file content")
}

func TestGoogleDriveClient_ReadFile_TruncatesLargeContent(t *testing.T) {
	withDriveService(t, &driveServiceFake{
		fileByID:  map[string]*drive.File{"large": {Id: "large", Name: "Large", MimeType: "text/plain"}},
		downloads: map[string]io.ReadCloser{"large": io.NopCloser(strings.NewReader(strings.Repeat("x", 1024*100+1)))},
	})

	client := intpkg.NewGoogleDriveClient(&MockTokenSource{})
	resp, err := client.ReadFile(context.Background(), "large")
	require.NoError(t, err)
	assert.Contains(t, resp, "[CONTENT TRUNCATED DUE TO 100KB LIMIT]")
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}
