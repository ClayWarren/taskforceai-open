package files

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type uploadReadErrorReader struct{}

func (uploadReadErrorReader) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func (uploadReadErrorReader) ReadAt([]byte, int64) (int, error) {
	return 0, errors.New("read failed")
}

func (uploadReadErrorReader) Seek(int64, int) (int64, error) {
	return 0, nil
}

func (uploadReadErrorReader) Close() error {
	return nil
}

func TestGetFile_InvalidUserIdentifier(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-1", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestGetFile_NotFound(t *testing.T) {
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, pgx.ErrNoRows
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/ghost", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestGetFile_Success(t *testing.T) {
	now := pgtype.Timestamp{Time: time.Unix(123, 0), Valid: true}
	q := &mockFilesQueries{
		getFileFunc: func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
			return developerFileRecordForTest(db.DeveloperFile{
				ID:        arg.ID,
				UserID:    arg.UserID,
				Filename:  "found.txt",
				CreatedAt: now,
			}), nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files/file-123", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var out FileRecord
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	assert.Equal(t, "file-123", out.ID)
}

func TestListFiles_CountFailure(t *testing.T) {
	q := &mockFilesQueries{
		listFilesFunc: func(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error) {
			return []DeveloperFileRecord{}, nil
		},
		countFilesFunc: func(ctx context.Context, userID int32) (int64, error) {
			return 0, errors.New("count failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestListFiles_DBError(t *testing.T) {
	q := &mockFilesQueries{
		listFilesFunc: func(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestListFiles_InvalidUserIdentifier(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestListFiles_Pagination(t *testing.T) {
	q := &mockFilesQueries{
		listFilesFunc: func(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error) {
			assert.Equal(t, int32(50), arg.Limit)
			assert.Equal(t, int32(20), arg.Offset)
			return []DeveloperFileRecord{}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files?limit=50&offset=20", nil)
	resp := serve(router, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestListFiles_Success(t *testing.T) {
	now := pgtype.Timestamp{Time: time.Unix(123, 0), Valid: true}
	q := &mockFilesQueries{
		listFilesFunc: func(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error) {
			return []DeveloperFileRecord{
				developerFileRecordForTest(db.DeveloperFile{ID: "f1", Filename: "a.txt", CreatedAt: now}),
				developerFileRecordForTest(db.DeveloperFile{ID: "f2", Filename: "b.txt", CreatedAt: now}),
			}, nil
		},
		countFilesFunc: func(ctx context.Context, userID int32) (int64, error) {
			return 2, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/files?limit=10", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var out FileListResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	assert.Len(t, out.Files, 2)
	assert.Equal(t, int64(2), out.Total)
}

func TestNewBlobClientAndEnvTokenProvider(t *testing.T) {
	provider := &envTokenProvider{token: "secret"}
	token, err := provider.GetToken("", "")
	require.NoError(t, err)
	assert.Equal(t, "secret", token)
	assert.NotNil(t, newBlobClient("secret"))
}

func TestNormalizeBlobPathname_Cases(t *testing.T) {
	assert.Equal(t, "foo/bar.txt", normalizeBlobPathname("  /foo/bar.txt  "))
	assert.Equal(t, "path/to/blob.png", normalizeBlobPathname("https://example.com/path/to/blob.png"))
	assert.Empty(t, normalizeBlobPathname(""))
}

func TestNormalizePagination(t *testing.T) {
	limit, offset := normalizePagination(0, -5)
	assert.Equal(t, int32(defaultListLimit), limit)
	assert.Equal(t, int32(0), offset)

	limit, offset = normalizePagination(maxListLimit+50, 10)
	assert.Equal(t, int32(maxListLimit), limit)
	assert.Equal(t, int32(10), offset)
}

func TestResolveOptionalOrgIDNilCases(t *testing.T) {
	id, err := resolveOptionalOrgID(nil, 0)
	require.NoError(t, err)
	assert.Nil(t, id)
}

func TestResolveOptionalOrgID_AuthOrg(t *testing.T) {
	id, err := resolveOptionalOrgID(nil, 500)
	require.NoError(t, err)
	assert.Equal(t, int32(500), *id)
}

func TestResolveOptionalOrgID_Invalid(t *testing.T) {
	tooBig := int(math.MaxInt32) + 1
	_, err := resolveOptionalOrgID(&tooBig, 0)
	require.Error(t, err)
}

func TestResolveOptionalOrgID_UserOrg(t *testing.T) {
	orgID := 123
	id, err := resolveOptionalOrgID(&orgID, 500)
	require.NoError(t, err)
	assert.Equal(t, int32(123), *id)
}

func TestSanitizeFilename(t *testing.T) {
	assert.Equal(t, "file.txt", sanitizeFilename("  file.txt  "))
	assert.Equal(t, "file_name.txt", sanitizeFilename("file name.txt"))
	assert.Equal(t, "__.txt", sanitizeFilename("你好.txt"))
	assert.Equal(t, "..", sanitizeFilename(".."))
}

func TestSanitizeFilenameEmptyResult(t *testing.T) {
	assert.Equal(t, "file.bin", sanitizeFilename("   "))
}

func TestSanitizeFilename_WhitespaceBecomesDefault(t *testing.T) {
	assert.Equal(t, "file.bin", sanitizeFilename("   "))
}

func TestLocalGeneratedBlobAndStorageHelpers(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "")
	assert.False(t, localGeneratedFileStorageEnabled())

	localGeneratedBlobs.Lock()
	localGeneratedBlobs.files = make(map[string]localGeneratedBlob)
	localGeneratedBlobs.Unlock()
	storeLocalGeneratedBlob("file-local", localGeneratedBlob{UserID: 1, Content: []byte("copy")})

	_, ok := loadLocalGeneratedBlob(localGeneratedBlobURL("file-local"), 2)
	assert.False(t, ok)
	_, ok = loadLocalGeneratedBlob(localGeneratedBlobURL("missing"), 1)
	assert.False(t, ok)

	deleteLocalGeneratedBlob("https://blob.example/file")

	releaseCalls := 0
	q := &mockFilesQueries{
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			releaseCalls++
			return nil
		},
		releaseExpiredFunc: func(ctx context.Context, userID int32) ([]int64, error) {
			return []int64{0, 5}, nil
		},
	}
	releaseUserStorage(context.Background(), q, 1, 1, 0)
	releaseExpiredUploadReservations(context.Background(), q, 1, 1)
	assert.Equal(t, 0, releaseCalls)

	releaseExpiredUploadReservations(context.Background(), &mockFilesQueries{
		releaseExpiredFunc: func(ctx context.Context, userID int32) ([]int64, error) {
			return nil, errors.New("release expired failed")
		},
	}, 1, 1)
}

func TestReadUploadFileContentReadError(t *testing.T) {
	_, err := readUploadFileContent(uploadReadErrorReader{})
	require.Error(t, err)
}

func TestReleaseUserStorageSurvivesRequestCancellation(t *testing.T) {
	requestCtx, cancel := context.WithCancel(context.Background())
	cancel()

	q := &mockFilesQueries{
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			require.NoError(t, ctx.Err())
			assert.Equal(t, StorageQuotaUpdateInput{UserID: 7, UsedBytes: 42}, arg)
			return nil
		},
	}

	releaseUserStorage(requestCtx, q, 7, 7, 42)
}

func TestRequireUploadFormData(t *testing.T) {
	_, err := handleUploadFileForm(context.Background(), &mockFilesQueries{}, adapterhandler.AuthContext{}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Missing file")

	_, _, err = requireUploadFormData(nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Missing file")

	_, _, err = requireUploadFormData(&uploadFileFormData{File: huma.FormFile{IsSet: true}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Missing file")

	file := huma.FormFile{IsSet: true, Filename: "notes.txt", File: uploadReadErrorReader{}}
	got, purpose, err := requireUploadFormData(&uploadFileFormData{File: file, Purpose: "assistants"})
	require.NoError(t, err)
	assert.Equal(t, "notes.txt", got.Filename)
	assert.Equal(t, "assistants", purpose)
}

func TestUploadDeveloperFileReadError(t *testing.T) {
	_, err := uploadDeveloperFile(context.Background(), &mockFilesQueries{}, uploadDeveloperFileInput{
		AuthContext: adapterhandler.AuthContext{
			User: &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"},
		},
		File: huma.FormFile{
			File:     uploadReadErrorReader{},
			Filename: "notes.txt",
		},
	})

	require.Error(t, err)
	var statusErr huma.StatusError
	require.ErrorAs(t, err, &statusErr)
	assert.Equal(t, http.StatusInternalServerError, statusErr.GetStatus())
}

func TestToFileRecord_Struct(t *testing.T) {
	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	fr := toFileRecord(developerFileRecordForTest(db.DeveloperFile{
		ID:        "f1",
		CreatedAt: now,
	}))
	assert.Equal(t, "f1", fr.ID)
	assert.Equal(t, now.Time.Unix(), fr.CreatedAt)
}

func TestUnixFromTimestamp(t *testing.T) {
	assert.Positive(t, unixFromTimestamp(pgtype.Timestamp{Valid: false}))
	ts := time.Unix(12345, 0)
	assert.Equal(t, int64(12345), unixFromTimestamp(pgtype.Timestamp{Time: ts, Valid: true}))
}

func TestStorageCategoriesFromStatsIncludesReservedBytes(t *testing.T) {
	categories := storageCategoriesFromStats([]DeveloperFileStorageStatsRecord{
		{Category: "files", Bytes: 100, Count: 2},
		{Category: "images", Bytes: 50, Count: 1},
		{Category: "generated_artifacts", Bytes: 25, Count: 1},
	}, 200)

	assert.Equal(t, []StorageCategory{
		{ID: "files", Label: "Files", Bytes: 100, Count: 2},
		{ID: "images", Label: "Images", Bytes: 50, Count: 1},
		{ID: "generated_artifacts", Label: "Generated artifacts", Bytes: 25, Count: 1},
		{ID: "pending_uploads", Label: "Pending uploads", Bytes: 25, Count: 0},
	}, categories)
}

func TestStorageCategoriesFromStatsSkipsInvalidStats(t *testing.T) {
	categories := storageCategoriesFromStats([]DeveloperFileStorageStatsRecord{
		{Category: "files", Bytes: -1, Count: 1},
		{Category: "images", Bytes: 50, Count: -1},
		{Category: "generated_artifacts", Bytes: 20, Count: 2},
	}, 100)

	assert.Equal(t, []StorageCategory{
		{ID: "files", Label: "Files"},
		{ID: "images", Label: "Images"},
		{ID: "generated_artifacts", Label: "Generated artifacts", Bytes: 20, Count: 2},
		{ID: "pending_uploads", Label: "Pending uploads", Bytes: 80},
	}, categories)
}

func TestGetStorageSummary(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{
		getQuotaFunc: func(ctx context.Context, userID int32) (StorageQuotaRecord, error) {
			assert.Equal(t, int32(1), userID)
			return StorageQuotaRecord{
				UserID:     userID,
				QuotaBytes: DefaultUserStorageQuotaBytes,
				UsedBytes:  3072,
			}, nil
		},
		storageStatsFunc: func(ctx context.Context, userID int32) ([]DeveloperFileStorageStatsRecord, error) {
			assert.Equal(t, int32(1), userID)
			return []DeveloperFileStorageStatsRecord{
				{Category: "files", Bytes: 1024, Count: 1},
				{Category: "images", Bytes: 2048, Count: 2},
			}, nil
		},
	})

	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/storage", nil))

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"usedBytes":3072`)
	assert.Contains(t, resp.Body.String(), `"quotaBytes":42949672960`)
	assert.Contains(t, resp.Body.String(), `"id":"files"`)
	assert.Contains(t, resp.Body.String(), `"label":"Images"`)
}

func TestGetStorageSummaryInvalidUserAndQuotaFailures(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/storage", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router = setupFilesRouter(user, &mockFilesQueries{
		ensureQuotaFunc: func(ctx context.Context, userID int32) error {
			return errors.New("ensure failed")
		},
	})
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/storage", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	router = setupFilesRouter(user, &mockFilesQueries{
		getQuotaFunc: func(ctx context.Context, userID int32) (StorageQuotaRecord, error) {
			return StorageQuotaRecord{}, errors.New("quota failed")
		},
	})
	resp = serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/storage", nil))
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestGetStorageSummaryStatsFailure(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{
		getQuotaFunc: func(ctx context.Context, userID int32) (StorageQuotaRecord, error) {
			return StorageQuotaRecord{UserID: userID, QuotaBytes: DefaultUserStorageQuotaBytes}, nil
		},
		storageStatsFunc: func(ctx context.Context, userID int32) ([]DeveloperFileStorageStatsRecord, error) {
			return nil, errors.New("stats unavailable")
		},
	})

	resp := serve(router, httptest.NewRequest(http.MethodGet, "/api/v1/developer/storage", nil))

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "Failed to load storage usage")
}

func TestUploadFile_CreateMetadataFailureCleansUpBlob(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example/file", Pathname: pathname}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error { return nil },
		}
	}

	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db insert failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "notes.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "Storage metadata error")
}

func TestUploadFile_CreateMetadataFailureLogsCleanupDeleteError(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example/file", Pathname: pathname}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				return errors.New("delete failed")
			},
		}
	}

	q := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			return DeveloperFileRecord{}, errors.New("db insert failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, err := writer.CreateFormFile("file", "notes.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte("hello"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestUploadFile_CustomPurpose(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example/" + pathname, Pathname: pathname}, nil
			},
		}
	}

	now := pgtype.Timestamp{Time: time.Unix(456, 0), Valid: true}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	queries := &mockFilesQueries{
		createFileFunc: func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
			assert.Equal(t, "fine-tune", arg.Purpose)
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
	router := setupFilesRouterWithContext(user, queries, 0)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "fine-tune"))
	fw, _ := writer.CreateFormFile("file", "notes.json")
	_, _ = fw.Write([]byte(`{"ok":true}`))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"purpose":"fine-tune"`)
}

func TestUploadFile_EmptyFileRejected(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, err := writer.CreateFormFile("file", "empty.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte{})
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "empty")
}

func TestUploadFile_ExceedsMaxSize(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "big.bin")
	_, _ = fw.Write(bytes.Repeat([]byte("x"), MaxFileSize+1))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "exceeds maximum size")
}

func TestUploadFile_InvalidOrgBlobDeleteFailureStillReturns500(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example/invalid-org", Pathname: pathname}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				return errors.New("delete failed")
			},
		}
	}

	invalidOrg := math.MaxInt32 + 1
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouterWithContext(user, &mockFilesQueries{}, invalidOrg)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "notes.txt")
	_, _ = fw.Write([]byte("%PDF-1.4 sample"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestUploadFile_InvalidOrgDeletesBlob(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)

	deleted := false
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return &vercelblob.PutBlobPutResult{URL: "https://blob.example/invalid-org", Pathname: pathname}, nil
			},
			deleteFunc: func(ctx context.Context, urls ...string) error {
				deleted = true
				return nil
			},
		}
	}

	invalidOrg := math.MaxInt32 + 1
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouterWithContext(user, &mockFilesQueries{}, invalidOrg)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "notes.txt")
	_, _ = fw.Write([]byte("%PDF-1.4 sample"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.True(t, deleted)
}

func TestUploadFile_InvalidUserIdentifier(t *testing.T) {
	router := setupFilesRouter(invalidUserForFilesTest(), &mockFilesQueries{})
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "notes.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestUploadFile_MissingBlobTokenAfterQuotaReserve(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, err := writer.CreateFormFile("file", "notes.pdf")
	require.NoError(t, err)
	_, err = fw.Write([]byte("%PDF-1.4 sample"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestUploadFile_MissingFile(t *testing.T) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("purpose", "assistants")
	_ = writer.Close()

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnprocessableEntity, resp.Code)
}

func TestUploadFile_QuotaExceeded(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			return pgx.ErrNoRows
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileWriter, err := writer.CreateFormFile("file", "test.txt")
	require.NoError(t, err)
	_, err = fileWriter.Write([]byte("hello"))
	require.NoError(t, err)
	_ = writer.Close()

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestUploadFile_QuotaUnavailable(t *testing.T) {
	q := &mockFilesQueries{
		ensureQuotaFunc: func(ctx context.Context, userID int32) error {
			return errors.New("quota service down")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
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

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestUploadFile_ReleaseQuotaFailureOnBlobPutError(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return nil, errors.New("put failed")
			},
		}
	}

	releaseCalls := 0
	q := &mockFilesQueries{
		releaseFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			releaseCalls++
			return errors.New("release failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "t.txt")
	_, _ = fw.Write([]byte("content"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Equal(t, 1, releaseCalls)
}

func TestUploadFile_ReserveQuotaGenericError(t *testing.T) {
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			return errors.New("reserve failed")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	fw, _ := writer.CreateFormFile("file", "notes.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestUploadFile_StorageError(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	restore(t, &newBlobClient)
	newBlobClient = func(_ string) blobClient {
		return &mockBlobClient{
			putFunc: func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
				return nil, errors.New("blob upload failed")
			},
		}
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("purpose", "assistants")
	fw, _ := writer.CreateFormFile("file", "t.txt")
	_, _ = fw.Write([]byte("content"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}
