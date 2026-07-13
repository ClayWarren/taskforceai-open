package files

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type mockFilesQueries struct {
	ensureQuotaFunc              func(ctx context.Context, userID int32) error
	getQuotaFunc                 func(ctx context.Context, userID int32) (StorageQuotaRecord, error)
	reserveFunc                  func(ctx context.Context, arg StorageQuotaUpdateInput) error
	releaseFunc                  func(ctx context.Context, arg StorageQuotaUpdateInput) error
	createUploadReservationFunc  func(ctx context.Context, arg CreateDeveloperFileUploadReservationInput) (DeveloperFileUploadReservationRecord, error)
	consumeUploadReservationFunc func(ctx context.Context, arg DeveloperFileUploadReservationLookupInput) (DeveloperFileUploadReservationRecord, error)
	releaseExpiredFunc           func(ctx context.Context, userID int32) ([]int64, error)
	createFileFunc               func(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error)
	getFileFunc                  func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error)
	listFilesFunc                func(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error)
	countFilesFunc               func(ctx context.Context, userID int32) (int64, error)
	storageStatsFunc             func(ctx context.Context, userID int32) ([]DeveloperFileStorageStatsRecord, error)
	markDeleteFunc               func(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error)
	restoreFunc                  func(ctx context.Context, arg DeveloperFileLookupInput) error
}

func (m *mockFilesQueries) EnsureUserStorageQuota(ctx context.Context, userID int32) error {
	if m.ensureQuotaFunc != nil {
		return m.ensureQuotaFunc(ctx, userID)
	}
	return nil
}

func (m *mockFilesQueries) GetUserStorageQuota(ctx context.Context, userID int32) (StorageQuotaRecord, error) {
	if m.getQuotaFunc != nil {
		return m.getQuotaFunc(ctx, userID)
	}
	return StorageQuotaRecord{UserID: userID, QuotaBytes: DefaultUserStorageQuotaBytes}, nil
}

func (m *mockFilesQueries) ReserveUserStorageBytes(ctx context.Context, arg StorageQuotaUpdateInput) error {
	if m.reserveFunc != nil {
		return m.reserveFunc(ctx, arg)
	}
	return nil
}

func (m *mockFilesQueries) ReleaseUserStorageBytes(ctx context.Context, arg StorageQuotaUpdateInput) error {
	if m.releaseFunc != nil {
		return m.releaseFunc(ctx, arg)
	}
	return nil
}

func (m *mockFilesQueries) CreateDeveloperFileUploadReservation(ctx context.Context, arg CreateDeveloperFileUploadReservationInput) (DeveloperFileUploadReservationRecord, error) {
	if m.createUploadReservationFunc != nil {
		return m.createUploadReservationFunc(ctx, arg)
	}
	return DeveloperFileUploadReservationRecord{
		FileID:        arg.FileID,
		UserID:        arg.UserID,
		BlobPath:      arg.BlobPath,
		ReservedBytes: arg.ReservedBytes,
		ExpiresAt:     arg.ExpiresAt,
	}, nil
}

func (m *mockFilesQueries) ConsumeDeveloperFileUploadReservation(ctx context.Context, arg DeveloperFileUploadReservationLookupInput) (DeveloperFileUploadReservationRecord, error) {
	if m.consumeUploadReservationFunc != nil {
		return m.consumeUploadReservationFunc(ctx, arg)
	}
	return DeveloperFileUploadReservationRecord{
		FileID:        arg.FileID,
		UserID:        arg.UserID,
		BlobPath:      arg.BlobPath,
		ReservedBytes: MaxFileSize,
	}, nil
}

func (m *mockFilesQueries) ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error) {
	if m.releaseExpiredFunc != nil {
		return m.releaseExpiredFunc(ctx, userID)
	}
	return nil, nil
}

func (m *mockFilesQueries) CreateDeveloperFile(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error) {
	if m.createFileFunc != nil {
		return m.createFileFunc(ctx, arg)
	}
	return DeveloperFileRecord{}, nil
}

func (m *mockFilesQueries) GetDeveloperFileByIDForUser(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
	if m.getFileFunc != nil {
		return m.getFileFunc(ctx, arg)
	}
	return DeveloperFileRecord{}, pgx.ErrNoRows
}

func (m *mockFilesQueries) ListDeveloperFilesByUser(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error) {
	if m.listFilesFunc != nil {
		return m.listFilesFunc(ctx, arg)
	}
	return []DeveloperFileRecord{}, nil
}

func (m *mockFilesQueries) CountDeveloperFilesByUser(ctx context.Context, userID int32) (int64, error) {
	if m.countFilesFunc != nil {
		return m.countFilesFunc(ctx, userID)
	}
	return 0, nil
}

func (m *mockFilesQueries) GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]DeveloperFileStorageStatsRecord, error) {
	if m.storageStatsFunc != nil {
		return m.storageStatsFunc(ctx, userID)
	}
	return []DeveloperFileStorageStatsRecord{}, nil
}

func (m *mockFilesQueries) MarkDeveloperFileDeleted(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error) {
	if m.markDeleteFunc != nil {
		return m.markDeleteFunc(ctx, arg)
	}
	return DeveloperFileRecord{}, pgx.ErrNoRows
}

func (m *mockFilesQueries) RestoreDeveloperFileDeletion(ctx context.Context, arg DeveloperFileLookupInput) error {
	if m.restoreFunc != nil {
		return m.restoreFunc(ctx, arg)
	}
	return nil
}

type mockBlobClient struct {
	putFunc    func(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error)
	headFunc   func(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error)
	downloadFn func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error)
	deleteFunc func(ctx context.Context, urls ...string) error
}

func (m *mockBlobClient) Put(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
	if m.putFunc != nil {
		return m.putFunc(ctx, pathname, body, options)
	}
	return nil, errors.New("putFunc not set")
}

func (m *mockBlobClient) Head(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error) {
	if m.headFunc != nil {
		return m.headFunc(ctx, pathname)
	}
	return nil, vercelblob.ErrBlobNotFound
}

func (m *mockBlobClient) Download(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
	if m.downloadFn != nil {
		return m.downloadFn(ctx, urlPath, options)
	}
	return nil, errors.New("downloadFn not set")
}

func (m *mockBlobClient) Delete(ctx context.Context, urls ...string) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, urls...)
	}
	return nil
}

func developerFileRecordForTest(file db.DeveloperFile) DeveloperFileRecord {
	return DeveloperFileRecord{
		ID:        file.ID,
		UserID:    file.UserID,
		Filename:  file.Filename,
		Purpose:   file.Purpose,
		MimeType:  file.MimeType,
		Bytes:     file.Bytes,
		BlobURL:   file.BlobUrl,
		BlobPath:  file.BlobPath,
		CreatedAt: file.CreatedAt,
		UpdatedAt: file.UpdatedAt,
	}
}

func setupFilesRouter(user *auth.AuthenticatedUser, q FilesQueries) *chi.Mux {
	return setupFilesRouterWithContext(user, q, 0)
}

func setupFilesRouterWithContext(user *auth.AuthenticatedUser, q FilesQueries, orgID int) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if user != nil {
				ctx = context.WithValue(ctx, adapterhandler.UserContextKey, user)
			}
			if orgID != 0 {
				ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, q)
	return r
}

func invalidUserForFilesTest() *auth.AuthenticatedUser {
	return &auth.AuthenticatedUser{ID: math.MaxInt32 + 1, Email: "overflow@example.com"}
}

// serve runs req against router and returns the recorder.
func serve(router http.Handler, req *http.Request) *httptest.ResponseRecorder {
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

// swap sets *target to val for the duration of the test and restores the
// previous value on cleanup. It collapses the repeated
// `old := X; X = val; defer/Cleanup restore` idiom into one call.
func swap[T any](t *testing.T, target *T, val T) {
	t.Helper()
	old := *target
	*target = val
	t.Cleanup(func() { *target = old })
}

// restore snapshots *target now and restores it on cleanup, without changing the
// current value. Use it when the test assigns the var later (possibly in several
// steps); use swap when the new value is known up front.
func restore[T any](t *testing.T, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}
