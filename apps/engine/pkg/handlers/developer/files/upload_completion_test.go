package files

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
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

func TestUploadFile_Success(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	oldBlobClient := newBlobClient
	t.Cleanup(func() {
		newBlobClient = oldBlobClient
	})
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				assert.Equal(t, "private", options.Access)
				return &vercelblob.PutBlobPutResult{
					URL:      "https://blob.example.com/test.txt",
					Pathname: pathname,
				}, nil
			},
		}
	}

	now := pgtype.Timestamp{Time: time.Unix(123, 0), Valid: true}
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			assert.Equal(t, int32(1), arg.UserID)
			assert.Equal(t, int64(5), arg.UsedBytes)
			return nil
		},
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
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
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("purpose", "assistants")
	fileWriter, err := writer.CreateFormFile("file", "test.txt")
	require.NoError(t, err)
	_, err = fileWriter.Write([]byte("hello"))
	require.NoError(t, err)
	_ = writer.Close()

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.ContentLength = int64(body.Len())
	resp := serve(router, req)

	if resp.Code != http.StatusOK {
		t.Log(resp.Body.String())
	}
	assert.Equal(t, http.StatusOK, resp.Code)
	var file FileRecord
	err = json.Unmarshal(resp.Body.Bytes(), &file)
	require.NoError(t, err)
	assert.Equal(t, "file", file.Object)
	assert.Equal(t, int64(5), file.Bytes)
	assert.Equal(t, int64(123), file.CreatedAt)
	assert.Equal(t, "test.txt", file.Filename)
	assert.Equal(t, "assistants", file.Purpose)
	assert.Equal(t, "text/plain", file.MimeType)
}

func TestUploadFile_Unauthorized(t *testing.T) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("purpose", "assistants")
	_ = writer.Close()

	router := setupFilesRouter(nil, &mockFilesQueries{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnprocessableEntity, resp.Code)
}

func TestUploadFile_UnsupportedDetectedMime(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "data.bin")
	_, _ = fw.Write([]byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05})
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusUnsupportedMediaType, resp.Code)
}

func TestUploadFile_UnsupportedType(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	// Mock blob client so it doesnt try real upload if it gets that far
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{}
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("purpose", "assistants")
	fileWriter, _ := writer.CreateFormFile("file", "test.zip")
	// PK zip magic bytes
	_, _ = fileWriter.Write([]byte{0x50, 0x4b, 0x03, 0x04})
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnsupportedMediaType, resp.Code)
}

func TestUploadFile_WithOrg(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example.com/f.txt", Pathname: pathname}, nil
			},
		}
	}

	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			assert.NotNil(t, arg.OrganizationID)
			assert.Equal(t, int32(100), *arg.OrganizationID)
			return developerFileRecordForTest(db.DeveloperFile{ID: arg.ID}), nil
		},
	}

	orgID := 100
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com", OrgID: &orgID}
	router := setupFilesRouter(user, q)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("purpose", "assistants")
	fw, _ := writer.CreateFormFile("file", "t.txt")
	_, _ = fw.Write([]byte("content"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestCreateUploadToken_ReservationFailureReleasesQuota(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	released := int64(0)
	q := &mockFilesQueries{
		createUploadReservationFunc: func(ctx context.Context, arg CreateDeveloperFileUploadReservationInput) (DeveloperFileUploadReservationRecord, error) {
			return DeveloperFileUploadReservationRecord{}, errors.New("reservation failed")
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released += arg.UsedBytes
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewReader([]byte(`{"filename":"notes.txt","mime_type":"text/plain"}`)))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Equal(t, int64(MaxFileSize), released)
}

func TestCompleteUpload_WhitespaceFieldValidation(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	tests := []string{
		`{"file_id":"   ","pathname":"developer-files/u1/file-1/notes.txt","filename":"notes.txt"}`,
		`{"file_id":"file-1","pathname":"developer-files/u1/file-1/notes.txt","filename":"   "}`,
		`{"file_id":"file-1","pathname":"   ","filename":"notes.txt"}`,
	}

	for _, body := range tests {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp := serve(router, req)
		assert.Equal(t, http.StatusBadRequest, resp.Code)
	}
}

func TestCompleteUpload_ReservationAndTokenFailureBranches(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}

	q := &mockFilesQueries{
		consumeUploadReservationFunc: func(ctx context.Context, arg DeveloperFileUploadReservationLookupInput) (DeveloperFileUploadReservationRecord, error) {
			return DeveloperFileUploadReservationRecord{}, pgx.ErrNoRows
		},
	}
	router := setupFilesRouter(user, q)
	body := `{"file_id":"file-missing","pathname":"developer-files/u1/file-missing/notes.txt","filename":"notes.txt"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)

	q = &mockFilesQueries{
		consumeUploadReservationFunc: func(ctx context.Context, arg DeveloperFileUploadReservationLookupInput) (DeveloperFileUploadReservationRecord, error) {
			return DeveloperFileUploadReservationRecord{}, errors.New("consume failed")
		},
	}
	router = setupFilesRouter(user, q)
	body = `{"file_id":"file-consume","pathname":"developer-files/u1/file-consume/notes.txt","filename":"notes.txt"}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp = serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	released := int64(0)
	q = &mockFilesQueries{
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			released += arg.UsedBytes
			return nil
		},
	}
	router = setupFilesRouter(user, q)
	body = `{"file_id":"file-token","pathname":"developer-files/u1/file-token/notes.txt","filename":"notes.txt"}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp = serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Equal(t, int64(MaxFileSize), released)
}

func TestCompleteUpload_CleanupAndSizeReservationBranches(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	deleteFailures := 0
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			headFunc: func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
				return &vercelblob.HeadBlobResult{
					URL:      "https://blob.example.com/notes.txt",
					Size:     6,
					Pathname: pathname,
					ETag:     "etag-reserved",
				}, nil
			},
			downloadFn: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("sample"), nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				deleteFailures++
				return errors.New("delete failed")
			},
		}
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	q := &mockFilesQueries{
		consumeUploadReservationFunc: func(ctx context.Context, arg DeveloperFileUploadReservationLookupInput) (DeveloperFileUploadReservationRecord, error) {
			return DeveloperFileUploadReservationRecord{FileID: arg.FileID, UserID: arg.UserID, BlobPath: arg.BlobPath, ReservedBytes: 1}, nil
		},
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			return nil
		},
	}
	router := setupFilesRouter(user, q)

	body := `{"file_id":"file-reserved","pathname":"developer-files/u1/file-reserved/notes.txt","filename":"notes.txt"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/complete", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Equal(t, 1, deleteFailures)
}
