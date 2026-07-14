package files

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/server"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateUploadToken_ErrorBranches(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewBufferString(`{"filename":"bad.exe","mime_type":"application/x-msdownload"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusUnsupportedMediaType, resp.Code)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewBufferString(`{"filename":"ok.txt","mime_type":"text/plain"}`))
	req.Header.Set("Content-Type", "application/json")
	resp = httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	router = setupFilesRouter(user, &mockFilesQueries{})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewBufferString(`{"filename":"ok.txt","mime_type":"text/plain"}`))
	req.Header.Set("Content-Type", "application/json")
	resp = httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestCreateUploadToken_GenerateTokenFailureDoesNotTouchQuota(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	swap(t, &generateBlobClientToken, func(token string, options vercelblob.ClientTokenOptions) (string, error) {
		return "", errors.New("token generation failed")
	})

	reserved := int64(0)
	released := int64(0)
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			reserved = arg.UsedBytes
			return nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released = arg.UsedBytes
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewReader([]byte(`{"filename":"notes.txt","mime_type":"text/plain"}`)))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Equal(t, int64(0), reserved)
	assert.Equal(t, int64(0), released)
}

func TestCreateUploadToken_InvalidUserIdentifier(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewReader([]byte(`{"filename":"notes.txt"}`)))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCreateUploadToken_MissingBlobToken(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := `{"filename":"notes.pdf","mime_type":"application/pdf"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCreateUploadToken_MissingFilename(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := bytes.NewBufferString(`{"filename":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", body)
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCreateUploadToken_Success(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := bytes.NewBufferString(`{"filename":"big.pdf","mime_type":"application/pdf","purpose":"assistants"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", body)
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var out uploadTokenResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	assert.True(t, strings.HasPrefix(out.FileID, "file-"))
	assert.Contains(t, out.Pathname, out.FileID)
	assert.NotEmpty(t, out.UploadToken)
	assert.NotEmpty(t, out.UploadURL)
	assert.Equal(t, int64(MaxFileSize), out.MaxBytes)
}

func TestDeleteFile_BlobMissing(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			deleteFunc: func(ctx context.Context, urls ...string) error {
				return errors.New("blob already gone")
			},
		}
	}

	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{ID: arg.ID, Bytes: 10, BlobUrl: "https://x.com/f"}), nil
		},
		restoreFunc: func(ctx context.Context, arg DeveloperFileLookupInput) error {
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDeleteFile_DBError(t *testing.T) {
	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDeleteFile_InvalidUserIdentifier(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDeleteFile_NotFoundAndTokenMissing(t *testing.T) {
	q := &mockFilesQueries{
		markDeleteFunc: func(context.Context, DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, pgx.ErrNoRows
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/missing", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusNotFound, resp.Code)

	q = &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{ID: arg.ID, UserID: arg.UserID, Bytes: 10, BlobUrl: "https://blob.example.com/file.txt"}), nil
		},
		restoreFunc: func(context.Context, DeveloperFileLookupInput) error {
			return nil
		},
	}
	router = setupFilesRouter(user, q)
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp = httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDeleteFile_TokenMissingRestoreFailure(t *testing.T) {
	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{ID: arg.ID, UserID: arg.UserID, Bytes: 10, BlobUrl: "https://blob.example.com/file.txt"}), nil
		},
		restoreFunc: func(context.Context, DeveloperFileLookupInput) error {
			return errors.New("restore failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	resp := serve(router, httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDeleteFile_ReleaseQuotaFailureStillSucceeds(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			deleteFunc: func(ctx context.Context, urls ...string) error { return nil },
		}
	}

	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:      arg.ID,
				Bytes:   9,
				BlobUrl: "https://blob.example/file.txt",
			}), nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			return errors.New("release failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestDeleteFile_LocalGeneratedReleaseFailureStillSucceeds(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()
	storeLocalGeneratedBlob("file-local-release", localGeneratedBlob{
		UserID:   1,
		Filename: "local.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html>"),
	})
	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "local.html",
				MimeType: "text/html",
				Bytes:    15,
				BlobURL:  localGeneratedBlobURL("file-local-release"),
				BlobPath: "file-local-release",
			}, nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			return errors.New("release failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	resp := serve(router, httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-local-release", nil))
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestDeleteFile_RestoreFailsAfterBlobDeleteFailure(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			deleteFunc: func(ctx context.Context, urls ...string) error {
				return errors.New("blob delete failed")
			},
		}
	}

	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:      arg.ID,
				Bytes:   5,
				BlobUrl: "https://blob.example/file.txt",
			}), nil
		},
		restoreFunc: func(ctx context.Context, arg DeveloperFileLookupInput) error {
			return errors.New("restore failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDeleteFile_Success(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			deleteFunc: func(ctx context.Context, urls ...string) error {
				require.Len(t, urls, 1)
				assert.Equal(t, "https://blob.example.com/file.txt", urls[0])
				return nil
			},
		}
	}

	released := int64(0)
	q := &mockFilesQueries{
		markDeleteFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:      arg.ID,
				UserID:  arg.UserID,
				Bytes:   5,
				BlobUrl: "https://blob.example.com/file.txt",
			}), nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released = arg.UsedBytes
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, int64(0), released)
}

func TestDownloadFileContent_BlobNotFound(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return nil, vercelblob.ErrBlobNotFound
			},
		}
	}

	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:      arg.ID,
				UserID:  arg.UserID,
				BlobUrl: "https://blob.example.com/missing.txt",
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestDownloadFileContent_ServesPrivateBlob(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "token", token)
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				assert.Equal(t, "users/1/file-1/content.txt", pathname)
				return &vercelblob.HeadBlobResult{Size: uint64(len("private content"))}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				assert.Equal(t, "https://blob.example.com/content.txt", urlPath)
				assert.Nil(t, options.ByteRange)
				return []byte("private content"), nil
			},
		}
	}

	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "content.txt",
				MimeType: "text/plain",
				BlobUrl:  "https://blob.example.com/content.txt",
				BlobPath: "users/1/file-1/content.txt",
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "private content", resp.Body.String())
	assert.Equal(t, "text/plain", resp.Header().Get("Content-Type"))
	assert.Equal(t, "15", resp.Header().Get("Content-Length"))
	assert.Equal(t, `attachment; filename=content.txt`, resp.Header().Get("Content-Disposition"))
}

func TestDownloadFileContent_InvalidUserAndMissingBlobToken(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:      arg.ID,
				UserID:  arg.UserID,
				BlobUrl: "https://blob.example.com/content.txt",
			}), nil
		},
	}
	router = setupFilesRouter(user, q)
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDownloadFileContent_RemoteBlobErrorBranches(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "content.txt",
				BlobUrl:  "https://blob.example.com/content.txt",
				BlobPath: "users/1/file-1/content.txt",
			}), nil
		},
	}
	router := setupFilesRouter(user, q)

	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return nil, errors.New("head failed")
			},
		}
	}
	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{Size: 3}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return nil, vercelblob.ErrBlobNotFound
			},
		}
	}
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil))
	assert.Equal(t, http.StatusNotFound, resp.Code)

	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{Size: 3}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return nil, errors.New("download failed")
			},
		}
	}
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return nil, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return make([]byte, server.VercelFunctionSafeBinaryPayloadBytes+1), nil
			},
		}
	}
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil))
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestDownloadFileContent_FallbackHeaders(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{Size: 3}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("abc"), nil
			},
		}
	}
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "content.bin",
				MimeType: "   ",
				BlobUrl:  "https://blob.example.com/content.bin",
				BlobPath: "users/1/file-1/content.bin",
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content?disposition=inline", nil))
	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "application/octet-stream", resp.Header().Get("Content-Type"))
	assert.Equal(t, `inline; filename=content.bin`, resp.Header().Get("Content-Disposition"))
	assert.Equal(t, "SAMEORIGIN", resp.Header().Get("X-Frame-Options"))
}

func TestDownloadFileContent_Returns413FromBlobHeadWithoutDownload(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	downloadCalled := false
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "token", token)
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				assert.Equal(t, "users/1/file-1/huge.bin", pathname)
				return &vercelblob.HeadBlobResult{
					Size: uint64(server.VercelFunctionSafeBinaryPayloadBytes) + 1,
				}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				downloadCalled = true
				return []byte("too late"), nil
			},
		}
	}

	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "huge.bin",
				Bytes:    0,
				BlobUrl:  "https://blob.example.com/huge.bin",
				BlobPath: "users/1/file-1/huge.bin",
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
	assert.False(t, downloadCalled)
}

func TestDownloadFileContent_Returns413WhenMetadataExceedsPayloadLimit(t *testing.T) {
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:      arg.ID,
				UserID:  arg.UserID,
				Bytes:   int64(server.VercelFunctionSafeBinaryPayloadBytes) + 1,
				BlobUrl: "https://blob.example.com/content.txt",
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestDownloadFileContent_AllowsInlineDisposition(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "token", token)
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{Size: uint64(len("<html><body>Preview</body></html>"))}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("<html><body>Preview</body></html>"), nil
			},
		}
	}

	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: "site.html",
				MimeType: "text/html",
				BlobUrl:  "https://blob.example.com/site.html",
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1/content?disposition=inline", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "text/html", resp.Header().Get("Content-Type"))
	assert.Equal(t, `inline; filename=site.html`, resp.Header().Get("Content-Disposition"))
	assert.Equal(t, "nosniff", resp.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "SAMEORIGIN", resp.Header().Get("X-Frame-Options"))
	csp := resp.Header().Get("Content-Security-Policy")
	assert.Contains(t, csp, "sandbox allow-scripts")
	assert.NotContains(t, csp, "allow-same-origin")
	assert.Contains(t, csp, "frame-ancestors 'self'")
}

func TestCreateGeneratedFile_UsesLocalFallbackWhenBlobTokenMissing(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()

	var created CreateDeveloperFileInput
	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			created = arg
			return DeveloperFileRecord{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: arg.Filename,
				Purpose:  arg.Purpose,
				MimeType: arg.MimeType,
				Bytes:    arg.Bytes,
				BlobURL:  arg.BlobURL,
				BlobPath: arg.BlobPath,
			}, nil
		},
	}

	record, err := CreateGeneratedFile(context.Background(), q, CreateGeneratedFileInput{
		UserID:   1,
		Filename: "local.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html><title>Site</title>"),
	})

	require.NoError(t, err)
	assert.Equal(t, "local.html", record.Filename)
	assert.Equal(t, "text/html", record.MimeType)
	assert.True(t, strings.HasPrefix(created.BlobURL, localGeneratedBlobURLPrefix))
	assert.Equal(t, created.ID, created.BlobPath)

	localGeneratedBlobs.RLock()
	blob, ok := localGeneratedBlobs.files[created.ID]
	localGeneratedBlobs.RUnlock()
	require.True(t, ok)
	assert.Equal(t, int32(1), blob.UserID)
	assert.Equal(t, []byte("<!doctype html><title>Site</title>"), blob.Content)
	assert.Equal(t, "text/html", blob.MimeType)
}

func TestCreateGeneratedFile_ValidationBranches(t *testing.T) {
	tests := []struct {
		name  string
		input CreateGeneratedFileInput
		want  int
	}{
		{
			name:  "invalid user",
			input: CreateGeneratedFileInput{UserID: int(math.MaxInt32) + 1, Filename: "site.html", MimeType: "text/html", Content: []byte("<html></html>")},
			want:  http.StatusInternalServerError,
		},
		{
			name:  "empty content",
			input: CreateGeneratedFileInput{UserID: 1, Filename: "site.html", MimeType: "text/html", Content: nil},
			want:  http.StatusBadRequest,
		},
		{
			name:  "too large",
			input: CreateGeneratedFileInput{UserID: 1, Filename: "site.html", MimeType: "text/html", Content: make([]byte, MaxFileSize+1)},
			want:  http.StatusBadRequest,
		},
		{
			name:  "unsupported generated mime type",
			input: CreateGeneratedFileInput{UserID: 1, Filename: "site.exe", MimeType: "application/x-msdownload", Content: []byte("MZ")},
			want:  http.StatusUnsupportedMediaType,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := CreateGeneratedFile(context.Background(), &mockFilesQueries{}, tt.input)
			require.Error(t, err)
			var statusErr huma.StatusError
			require.ErrorAs(t, err, &statusErr)
			assert.Equal(t, tt.want, statusErr.GetStatus())
		})
	}
}

func TestCreateGeneratedFile_ReserveFailure(t *testing.T) {
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			return errors.New("reserve failed")
		},
	}

	_, err := CreateGeneratedFile(context.Background(), q, CreateGeneratedFileInput{
		UserID:   1,
		Filename: "site.html",
		MimeType: "text/html",
		Content:  []byte("<!doctype html>"),
	})

	require.Error(t, err)
	var statusErr huma.StatusError
	require.ErrorAs(t, err, &statusErr)
	assert.Equal(t, http.StatusInternalServerError, statusErr.GetStatus())
}

func TestCreateGeneratedFile_StorageBackendUnavailable(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")

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
	var statusErr huma.StatusError
	require.ErrorAs(t, err, &statusErr)
	assert.Equal(t, http.StatusInternalServerError, statusErr.GetStatus())
	assert.Equal(t, int64(len("<!doctype html>")), released)
}

func TestCreateGeneratedFile_RemoteUploadSuccess(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	var uploadedPath string
	var uploadedBody string
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "token", token)
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				uploadedPath = pathname
				content, err := io.ReadAll(body)
				require.NoError(t, err)
				uploadedBody = string(content)
				assert.False(t, options.AddRandomSuffix)
				assert.Equal(t, "application/pdf", options.ContentType)
				assert.Equal(t, "private", options.Access)
				return &vercelblob.PutBlobPutResult{
					URL:      "https://blob.example/generated/site.html",
					Pathname: pathname,
				}, nil
			},
		}
	}

	var created CreateDeveloperFileInput
	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			created = arg
			return DeveloperFileRecord{
				ID:       arg.ID,
				UserID:   arg.UserID,
				Filename: arg.Filename,
				Purpose:  arg.Purpose,
				MimeType: arg.MimeType,
				Bytes:    arg.Bytes,
				BlobURL:  arg.BlobURL,
				BlobPath: arg.BlobPath,
			}, nil
		},
	}

	record, err := CreateGeneratedFile(context.Background(), q, CreateGeneratedFileInput{
		UserID:   1,
		Filename: "../site.html",
		MimeType: "",
		Content:  []byte("%PDF-1.4\n"),
	})

	require.NoError(t, err)
	assert.Equal(t, "site.html", record.Filename)
	assert.Equal(t, "assistants", record.Purpose)
	assert.Equal(t, int64(len("%PDF-1.4\n")), record.Bytes)
	assert.Contains(t, uploadedPath, "/site.html")
	assert.Equal(t, "%PDF-1.4\n", uploadedBody)
	assert.Equal(t, created.BlobPath, uploadedPath)
	assert.Equal(t, "https://blob.example/generated/site.html", created.BlobURL)
}
