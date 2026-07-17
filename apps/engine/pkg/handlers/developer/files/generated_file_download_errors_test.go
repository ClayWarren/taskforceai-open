package files

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/server"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateGeneratedFile_RemoteUploadFailureReleasesQuota(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return nil, errors.New("put failed")
			},
		}
	}

	released := int64(0)
	q := &mockFilesQueries{
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released += arg.UsedBytes
			return nil
		},
	}

	_, err := CreateGeneratedFile(context.Background(), q, CreateGeneratedFileInput{
		UserID:   1,
		Filename: "site.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html>"),
	})

	require.Error(t, err)
	assert.Equal(t, int64(len("<!doctype html>")), released)
}

func TestCreateGeneratedFile_MetadataFailureDeletesRemoteBlobAndReleasesQuota(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	deleted := false
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{
					URL:      "https://blob.example/generated/site.html",
					Pathname: pathname,
				}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				deleted = true
				assert.Equal(t, []string{"https://blob.example/generated/site.html"}, urls)
				return errors.New("delete failed")
			},
		}
	}

	released := int64(0)
	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("metadata failed")
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released += arg.UsedBytes
			return nil
		},
	}

	_, err := CreateGeneratedFile(context.Background(), q, CreateGeneratedFileInput{
		UserID:   1,
		Filename: "site.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html>"),
	})

	require.Error(t, err)
	assert.True(t, deleted)
	assert.Equal(t, int64(len("<!doctype html>")), released)
}

func TestCreateGeneratedFile_LocalFallbackMetadataFailureCleansBlobAndQuota(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()

	released := int64(0)
	var createdID string
	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			createdID = arg.ID
			return DeveloperFileRecord{}, errors.New("metadata failed")
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released += arg.UsedBytes
			return nil
		},
	}

	_, err := CreateGeneratedFile(context.Background(), q, CreateGeneratedFileInput{
		UserID:   1,
		Filename: "local.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html>"),
	})

	require.Error(t, err)
	assert.Equal(t, int64(len("<!doctype html>")), released)
	localGeneratedBlobs.RLock()
	_, found := localGeneratedBlobs.files[createdID]
	localGeneratedBlobs.RUnlock()
	assert.False(t, found)
}

func TestDownloadFileContent_ServesLocalGeneratedBlob(t *testing.T) {
	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()
	storeLocalGeneratedBlob("file-local", localGeneratedBlob{
		UserID:   1,
		Filename: "local.xlsx",
		MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Content:  []byte("xlsx bytes"),
	})
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "local.xlsx",
				MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				BlobURL:  localGeneratedBlobURL("file-local"),
			}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-local/content", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "xlsx bytes", resp.Body.String())
	assert.Equal(t, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resp.Header().Get("Content-Type"))
	assert.Equal(t, "10", resp.Header().Get("Content-Length"))
	assert.Equal(t, `attachment; filename=local.xlsx`, resp.Header().Get("Content-Disposition"))
}

func TestDownloadFileContent_LocalGeneratedBlobFallbacks(t *testing.T) {
	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()
	storeLocalGeneratedBlob("file-local-default-type", localGeneratedBlob{
		UserID:   1,
		Filename: "local.bin",
		MimeType: "   ",
		Content:  []byte("bytes"),
	})
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{
				ID:      arg.ID,
				UserID:  arg.UserID,
				BlobURL: localGeneratedBlobURL("file-local-default-type"),
			}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-local-default-type/content", nil))
	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "application/octet-stream", resp.Header().Get("Content-Type"))

	storeLocalGeneratedBlob("file-local-too-large", localGeneratedBlob{
		UserID:   1,
		Filename: "large.bin",
		MimeType: "application/octet-stream",
		Content:  make([]byte, server.VercelFunctionSafeBinaryPayloadBytes+1),
	})
	q = &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{
				ID:      arg.ID,
				UserID:  arg.UserID,
				BlobURL: localGeneratedBlobURL("file-local-too-large"),
			}, nil
		},
	}
	router = setupFilesRouter(user, q)
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-local-too-large/content", nil))
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestDeleteFile_RemovesLocalGeneratedBlobWithoutBlobToken(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()
	storeLocalGeneratedBlob("file-local", localGeneratedBlob{
		UserID:   1,
		Filename: "local.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html>"),
	})
	released := int64(0)
	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			assert.Equal(t, "file-local", arg.ID)
			assert.Equal(t, int32(1), arg.UserID)
			return DeveloperFileRecord{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "local.html",
				MimeType: "text/html",
				Bytes:    15,
				BlobURL:  localGeneratedBlobURL("file-local"),
				BlobPath: "file-local",
			}, nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released = arg.UsedBytes
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-local", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, int64(0), released)
	localGeneratedBlobs.RLock()
	_, found := localGeneratedBlobs.files["file-local"]
	localGeneratedBlobs.RUnlock()
	assert.False(t, found)
}

func TestDownloadFile_DatabaseError(t *testing.T) {
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db unavailable")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDownloadFile_FetchFailure(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db unavailable")
		},
	}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-404/content", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestEnvTokenProvider_GetToken(t *testing.T) {
	p := &envTokenProvider{token: "secret"}
	tok, err := p.GetToken("", "")
	require.NoError(t, err)
	assert.Equal(t, "secret", tok)
}

func TestDeveloperFileBlobHeadPath(t *testing.T) {
	assert.Equal(t, "blob/path.txt", developerFileBlobHeadPath(DeveloperFileRecord{BlobPath: "  blob/path.txt  ", BlobURL: "https://blob.example/unused"}))
	assert.Equal(t, "blob/path.txt", developerFileBlobHeadPath(DeveloperFileRecord{BlobURL: "https://blob.example/blob/path.txt"}))
}

func TestGetDeveloperFile_FetchFailure(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			if arg.ID == "file-db-error" {
				return DeveloperFileRecord{}, errors.New("db unavailable")
			}
			return DeveloperFileRecord{}, pgx.ErrNoRows
		},
	}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-db-error", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestGetFile_DatabaseError(t *testing.T) {
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db unavailable")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}
