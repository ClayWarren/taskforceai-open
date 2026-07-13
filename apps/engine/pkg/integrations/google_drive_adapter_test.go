package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

func TestDriveServiceAdapterMethods(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/files") && !strings.Contains(r.URL.Path, "/files/"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"files": []map[string]string{
					{"id": "file-1", "name": "Report", "mimeType": "text/plain"},
				},
			})
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/export"):
			_, _ = w.Write([]byte("exported"))
		case r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/files/file-1"):
			if r.URL.Query().Get("alt") == "media" {
				_, _ = w.Write([]byte("binary"))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{
				"id": "file-1", "name": "Report", "mimeType": "text/plain",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx := context.Background()
	tokenSource := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "token"})
	srv, err := drive.NewService(ctx,
		option.WithTokenSource(tokenSource),
		option.WithEndpoint(server.URL+"/"),
	)
	require.NoError(t, err)

	adapter := &driveServiceAdapter{svc: srv}
	files, err := adapter.ListFiles(ctx, "name contains 'Report'")
	require.NoError(t, err)
	require.Len(t, files, 1)
	assert.Equal(t, "Report", files[0].Name)

	file, err := adapter.GetFile(ctx, "file-1")
	require.NoError(t, err)
	assert.Equal(t, "file-1", file.Id)

	exportBody, err := adapter.ExportFile(ctx, "file-1", "text/plain")
	require.NoError(t, err)
	exported, err := io.ReadAll(exportBody)
	require.NoError(t, err)
	assert.Equal(t, "exported", string(exported))
	_ = exportBody.Close()

	downloadBody, err := adapter.DownloadFile(ctx, "file-1")
	require.NoError(t, err)
	downloaded, err := io.ReadAll(downloadBody)
	require.NoError(t, err)
	assert.NotEmpty(t, downloaded)
	_ = downloadBody.Close()
}

func TestDriveServiceAdapterErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "drive failure", http.StatusInternalServerError)
	}))
	defer server.Close()

	ctx := context.Background()
	tokenSource := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "token"})
	srv, err := drive.NewService(ctx,
		option.WithTokenSource(tokenSource),
		option.WithEndpoint(server.URL+"/"),
	)
	require.NoError(t, err)

	adapter := &driveServiceAdapter{svc: srv}
	_, err = adapter.ListFiles(ctx, "")
	require.Error(t, err)

	_, err = adapter.GetFile(ctx, "file-1")
	require.Error(t, err)

	_, err = adapter.ExportFile(ctx, "file-1", "text/plain")
	require.Error(t, err)

	_, err = adapter.DownloadFile(ctx, "file-1")
	assert.Error(t, err)
}

func TestDriveServiceBuilderSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"files": []any{}})
	}))
	defer server.Close()

	originalBuilder := DriveServiceBuilder
	defer func() { DriveServiceBuilder = originalBuilder }()

	DriveServiceBuilder = func(ctx context.Context, ts oauth2.TokenSource) (DriveService, error) {
		srv, err := drive.NewService(ctx,
			option.WithTokenSource(ts),
			option.WithEndpoint(server.URL+"/"),
		)
		if err != nil {
			return nil, err
		}
		return &driveServiceAdapter{svc: srv}, nil
	}

	client := NewGoogleDriveClient(oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "token"}))
	resp, err := client.ListFiles(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, "No files found.", resp)
}

func TestDriveServiceBuilderError(t *testing.T) {
	originalNewDriveService := newDriveService
	newDriveService = func(ctx context.Context, opts ...option.ClientOption) (*drive.Service, error) {
		return nil, errors.New("drive constructor failed")
	}
	t.Cleanup(func() { newDriveService = originalNewDriveService })

	_, err := DriveServiceBuilder(context.Background(), oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "token"}))
	require.EqualError(t, err, "drive constructor failed")
}

func TestDriveServiceBuilderDefaultSuccess(t *testing.T) {
	originalNewDriveService := newDriveService
	newDriveService = func(ctx context.Context, opts ...option.ClientOption) (*drive.Service, error) {
		return &drive.Service{}, nil
	}
	t.Cleanup(func() { newDriveService = originalNewDriveService })

	svc, err := DriveServiceBuilder(context.Background(), oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "token"}))
	require.NoError(t, err)
	require.IsType(t, &driveServiceAdapter{}, svc)
}
