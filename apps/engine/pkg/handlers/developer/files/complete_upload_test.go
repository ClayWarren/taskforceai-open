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
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type completeUploadFixture struct {
	t        *testing.T
	q        *mockFilesQueries
	client   *mockBlobClient
	user     *auth.AuthenticatedUser
	orgID    int
	deleted  []string
	released int64
}

func newCompleteUploadFixture(t *testing.T) *completeUploadFixture {
	t.Helper()
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	f := &completeUploadFixture{
		t:    t,
		user: &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"},
	}
	f.q = &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			now := pgtype.Timestamp{Time: time.Unix(123, 0), Valid: true}
			return developerFileRecordForTest(db.DeveloperFile{
				ID: arg.ID, UserID: arg.UserID, Filename: arg.Filename, Purpose: arg.Purpose,
				MimeType: arg.MimeType, Bytes: arg.Bytes, BlobUrl: arg.BlobURL, BlobPath: arg.BlobPath,
				CreatedAt: now, UpdatedAt: now,
			}), nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			f.released += arg.UsedBytes
			return nil
		},
	}
	f.client = &mockBlobClient{
		headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
			return &vercelblob.HeadBlobResult{
				URL: "https://blob.example/data.txt", Size: 6, Pathname: pathname,
				ContentType: "text/plain", ETag: "etag-test",
			}, nil
		},
		downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
			return []byte("sample"), nil
		},
		putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
			return &vercelblob.PutBlobPutResult{URL: "https://blob.example.com/final/data.txt", Pathname: pathname}, nil
		},
		deleteFunc: func(ctx context.Context, urls ...string) error {
			f.deleted = append(f.deleted, urls...)
			return nil
		},
	}
	swap(t, &newBlobClient, func(string) blobClient { return f.client })
	return f
}

func (f *completeUploadFixture) request(fileID, filename string) completeUploadRequest {
	f.t.Helper()
	return completeUploadRequest{
		FileID: fileID, Pathname: blobPathForFile(f.user.ID, fileID, filename), Filename: filename,
	}
}

func (f *completeUploadFixture) complete(fileID, filename string) *httptest.ResponseRecorder {
	f.t.Helper()
	return f.post(f.request(fileID, filename))
}

func (f *completeUploadFixture) post(body completeUploadRequest) *httptest.ResponseRecorder {
	f.t.Helper()
	encoded, err := json.Marshal(body)
	require.NoError(f.t, err)
	return f.postRaw(string(encoded))
}

func (f *completeUploadFixture) postRaw(body string) *httptest.ResponseRecorder {
	f.t.Helper()
	router := setupFilesRouterWithContext(f.user, f.q, f.orgID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return serve(router, req)
}

func TestAllowedMimeType(t *testing.T) {
	assert.True(t, allowedMimeType("text/plain"))
	assert.False(t, allowedMimeType("application/x-msdownload"))
}

func TestCompleteUpload_AlreadyCompletedReturnsConflict(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.q.getFileFunc = func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
		return developerFileRecordForTest(db.DeveloperFile{ID: arg.ID, UserID: arg.UserID}), nil
	}

	resp := f.complete("file-xyz", "data.txt")
	assert.Equal(t, http.StatusConflict, resp.Code)
}

func TestCompleteUpload_CheckExistingFileDBError(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.q.getFileFunc = func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
		return DeveloperFileRecord{}, errors.New("db unavailable")
	}

	resp := f.complete("file-db-err", "notes.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCompleteUpload_DownloadValidationFailure(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.downloadFn = func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
		return nil, errors.New("download failed")
	}

	resp := f.complete("file-dl", "data.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCompleteUpload_DownloadedEmptyContent(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.downloadFn = func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
		return []byte{}, nil
	}

	resp := f.complete("file-empty-download", "data.txt")
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Len(t, f.deleted, 1)
	assert.Equal(t, int64(MaxFileSize), f.released)
}

func TestCompleteUpload_DownloadedOversizeReleasesReservation(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.downloadFn = func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
		return bytes.Repeat([]byte("x"), MaxFileSize+1), nil
	}

	resp := f.complete("file-oversize-download", "data.txt")
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Len(t, f.deleted, 1)
	assert.Equal(t, int64(MaxFileSize), f.released)
}

func TestCompleteUpload_SealPutFailureReleasesReservation(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.putFunc = func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
		assert.Equal(t, blobFinalPathForFile(1, "file-put", "data.txt"), pathname)
		assert.Empty(t, options.IfMatch)
		return nil, errors.New("put failed")
	}
	f.q.createFileFunc = func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
		t.Fatal("metadata should not be created when sealing copy fails")
		return DeveloperFileRecord{}, nil
	}

	resp := f.complete("file-put", "data.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Len(t, f.deleted, 1)
	assert.Equal(t, int64(MaxFileSize), f.released)
}

func TestCompleteUpload_SealPutMissingResponseReleasesReservation(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.putFunc = func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
		return nil, nil
	}
	f.q.createFileFunc = func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
		t.Fatal("metadata should not be created when sealing response is missing")
		return DeveloperFileRecord{}, nil
	}

	resp := f.complete("file-put-nil", "data.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Len(t, f.deleted, 1)
	assert.Equal(t, int64(MaxFileSize), f.released)
}

func TestCompleteUpload_SealPutMissingURLCleansFinalPath(t *testing.T) {
	f := newCompleteUploadFixture(t)
	finalPath := blobFinalPathForFile(1, "file-put-empty-url", "data.txt")
	f.client.putFunc = func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
		return &vercelblob.PutBlobPutResult{Pathname: pathname}, nil
	}
	f.client.deleteFunc = func(ctx context.Context, urls ...string) error {
		f.deleted = append(f.deleted, urls...)
		if len(urls) == 1 && urls[0] == finalPath {
			return errors.New("delete final path failed")
		}
		return nil
	}
	f.q.createFileFunc = func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
		t.Fatal("metadata should not be created when sealed URL is missing")
		return DeveloperFileRecord{}, nil
	}

	resp := f.complete("file-put-empty-url", "data.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, f.deleted, "https://blob.example/data.txt")
	assert.Contains(t, f.deleted, finalPath)
	assert.Equal(t, int64(MaxFileSize), f.released)
}

func TestCompleteUpload_SealPutEmptyPathnameFallsBackToFinalPath(t *testing.T) {
	f := newCompleteUploadFixture(t)
	finalPath := blobFinalPathForFile(1, "file-put-empty-path", "data.txt")
	f.client.putFunc = func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
		return &vercelblob.PutBlobPutResult{URL: "https://blob.example/final/data.txt"}, nil
	}

	now := pgtype.Timestamp{Time: time.Unix(456, 0), Valid: true}
	f.q.createFileFunc = func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
		assert.Equal(t, finalPath, arg.BlobPath)
		return developerFileRecordForTest(db.DeveloperFile{
			ID: arg.ID, UserID: arg.UserID, Filename: arg.Filename, Purpose: arg.Purpose,
			MimeType: arg.MimeType, Bytes: arg.Bytes, BlobUrl: arg.BlobURL, BlobPath: arg.BlobPath,
			CreatedAt: now, UpdatedAt: now,
		}), nil
	}

	resp := f.complete("file-put-empty-path", "data.txt")
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestCompleteUpload_ErrorBranches(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.q.getFileFunc = func(context.Context, DeveloperFileLookupInput) (DeveloperFileRecord, error) {
		return DeveloperFileRecord{}, errors.New("lookup failed")
	}
	resp := f.complete("file-abc", "notes.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	f.q.getFileFunc = func(context.Context, DeveloperFileLookupInput) (DeveloperFileRecord, error) {
		return DeveloperFileRecord{}, pgx.ErrNoRows
	}
	f.client.headFunc = func(context.Context, string) (*vercelblob.HeadBlobResult, error) {
		return nil, errors.New("head failed")
	}
	resp = f.complete("file-abc", "notes.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	f.client.headFunc = func(ctx context.Context, givenPath string) (*vercelblob.HeadBlobResult, error) {
		return &vercelblob.HeadBlobResult{URL: "https://blob.example.com/empty.txt", Size: 0, Pathname: givenPath, ContentType: "text/plain"}, nil
	}
	resp = f.complete("file-empty", "empty.txt")
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestCompleteUpload_HeadOversizeDeletesBlob(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.headFunc = func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
		return &vercelblob.HeadBlobResult{URL: "https://blob.example/huge.bin", Size: uint64(MaxFileSize) + 1, Pathname: pathname}, nil
	}

	resp := f.complete("file-huge", "huge.bin")
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Len(t, f.deleted, 1)
}

func TestCompleteUpload_InvalidOrgAndCreateMetadataFailure(t *testing.T) {
	f := newCompleteUploadFixture(t)
	invalidOrg := math.MaxInt32 + 1
	f.orgID = invalidOrg
	resp := f.complete("file-org", "notes.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	f.orgID = 0
	f.client.putFunc = func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
		assert.Equal(t, blobFinalPathForFile(1, "file-meta", "notes.txt"), pathname)
		assert.Empty(t, options.IfMatch)
		return &vercelblob.PutBlobPutResult{URL: "https://blob.example/final/notes.txt", Pathname: pathname}, nil
	}
	f.q.createFileFunc = func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
		return DeveloperFileRecord{}, errors.New("metadata insert failed")
	}
	resp = f.complete("file-meta", "notes.txt")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCompleteUpload_InvalidPath(t *testing.T) {
	f := newCompleteUploadFixture(t)
	body := f.request("file-abc", "notes.txt")
	body.Pathname = "evil/path.txt" // Does not match u1/file-abc.
	resp := f.post(body)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCompleteUpload_InvalidUserIdentifier(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.user = invalidUserForFilesTest()
	resp := f.postRaw(`{"file_id":"file-1","pathname":"p","filename":"n.txt"}`)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCompleteUpload_MissingFieldValidation(t *testing.T) {
	f := newCompleteUploadFixture(t)
	tests := []struct {
		name string
		body string
	}{
		{name: "missing file id", body: `{"filename":"notes.pdf","pathname":"developer-files/u1/file-1/notes.pdf"}`},
		{name: "missing filename", body: `{"file_id":"file-1","pathname":"developer-files/u1/file-1/notes.pdf"}`},
		{name: "missing pathname", body: `{"file_id":"file-1","filename":"notes.pdf"}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resp := f.postRaw(tc.body)
			assert.Equal(t, http.StatusUnprocessableEntity, resp.Code)
		})
	}
}

func TestCompleteUpload_MissingRequiredFields(t *testing.T) {
	f := newCompleteUploadFixture(t)
	resp := f.postRaw(`{"pathname":"p","filename":"f.txt"}`)
	assert.Equal(t, http.StatusUnprocessableEntity, resp.Code)
}

func TestCompleteUpload_NotFound(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.headFunc = func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
		return nil, vercelblob.ErrBlobNotFound
	}

	resp := f.complete("f1", "t.txt")
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestCompleteUpload_OversizeHeadDeletesBlob(t *testing.T) {
	f := newCompleteUploadFixture(t)
	f.client.headFunc = func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
		return &vercelblob.HeadBlobResult{URL: "https://blob.example/big.bin", Size: uint64(MaxFileSize) + 1, Pathname: pathname}, nil
	}

	resp := f.complete("file-big", "big.bin")
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Len(t, f.deleted, 1)
}

func TestCompleteUpload_MetadataFailureDeletesBlobAndReleasesReservation(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	deleted := 0
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, givenPath string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{
					URL:         "https://blob.example.com/data.txt",
					Size:        8,
					Pathname:    givenPath,
					ContentType: "text/plain",
					ETag:        "etag-meta",
				}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("sample"), nil
			},
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				assert.Equal(t, blobFinalPathForFile(1, "file-xyz", "data.txt"), pathname)
				assert.Equal(t, "text/plain", options.ContentType)
				assert.Equal(t, "private", options.Access)
				written, err := io.ReadAll(body)
				require.NoError(t, err)
				assert.Equal(t, []byte("sample"), written)
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example.com/final/data.txt", Pathname: pathname}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				deleted += len(urls)
				if len(urls) == 1 && urls[0] == "https://blob.example.com/final/data.txt" {
					return errors.New("delete sealed blob failed")
				}
				return nil
			},
		}
	}

	released := int64(0)
	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db unavailable")
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released += arg.UsedBytes
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := bytes.NewBufferString(`{"file_id":"file-xyz","pathname":"developer-files/u1/file-xyz/data.txt","filename":"data.txt","purpose":"assistants","mime_type":"text/plain"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", body)
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Equal(t, 2, deleted)
	assert.Equal(t, int64(MaxFileSize), released)
}

func TestCompleteUpload_Success(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	pathname := "developer-files/u1/file-abc/notes.txt"
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, givenPath string) (*vercelblob.HeadBlobResult, error) {
				assert.Equal(t, pathname, givenPath)
				return &vercelblob.HeadBlobResult{
					URL:         "https://blob.example.com/notes.txt",
					Size:        6,
					Pathname:    givenPath,
					ContentType: "text/plain",
					ETag:        "etag-success",
				}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("sample"), nil
			},
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				assert.Equal(t, blobFinalPathForFile(1, "file-abc", "notes.txt"), pathname)
				assert.Equal(t, "text/plain", options.ContentType)
				assert.Equal(t, "private", options.Access)
				assert.Empty(t, options.IfMatch)
				written, err := io.ReadAll(body)
				require.NoError(t, err)
				assert.Equal(t, []byte("sample"), written)
				return &vercelblob.PutBlobPutResult{
					URL:      "https://blob.example.com/final/notes.txt",
					Pathname: pathname,
				}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				assert.Equal(t, []string{"https://blob.example.com/notes.txt"}, urls)
				return nil
			},
		}
	}

	now := pgtype.Timestamp{Time: time.Unix(123, 0), Valid: true}
	released := int64(0)
	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			assert.Equal(t, "file-abc", arg.ID)
			assert.Equal(t, blobFinalPathForFile(1, "file-abc", "notes.txt"), arg.BlobPath)
			assert.Equal(t, "https://blob.example.com/final/notes.txt", arg.BlobURL)
			return developerFileRecordForTest(db.DeveloperFile{
				ID:        arg.ID,
				UserID:    arg.UserID,
				Filename:  arg.Filename,
				Purpose:   arg.Purpose,
				MimeType:  arg.MimeType,
				Bytes:     arg.Bytes,
				BlobUrl:   arg.BlobURL,
				BlobPath:  arg.BlobPath,
				CreatedAt: now,
				UpdatedAt: now,
			}), nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			assert.Equal(t, int32(1), arg.UserID)
			released = arg.UsedBytes
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := bytes.NewBufferString(`{"file_id":"file-abc","pathname":"developer-files/u1/file-abc/notes.txt","filename":"notes.txt","purpose":"assistants","mime_type":"text/plain"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", body)
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var file FileRecord
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &file))
	assert.Equal(t, "file-abc", file.ID)
	assert.Equal(t, int64(6), file.Bytes)
	assert.Equal(t, int64(MaxFileSize-6), released)
}

func TestCompleteUpload_UsesContentSniffingForMimeValidation(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	deleted := 0
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, givenPath string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{
					URL:         "https://blob.example.com/data.bin",
					Size:        12,
					Pathname:    givenPath,
					ContentType: "text/plain",
					ETag:        "etag-zip",
				}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("PK\x03\x04binary"), nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				deleted += len(urls)
				return nil
			},
		}
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := bytes.NewBufferString(`{"file_id":"file-zip","pathname":"developer-files/u1/file-zip/data.bin","filename":"data.bin","purpose":"assistants","mime_type":"text/plain"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", body)
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnsupportedMediaType, resp.Code)
	assert.Equal(t, 1, deleted)
}
