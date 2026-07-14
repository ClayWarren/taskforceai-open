package files

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
)

func TestCreateUploadToken_DefaultMimeType(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, &mockFilesQueries{})

	body := `{"filename":"notes.pdf","mime_type":"   "}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnsupportedMediaType, resp.Code)
}

func TestCreateUploadToken_ReservesQuotaBeforeCompletion(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	reserved := int64(0)
	var reservation CreateDeveloperFileUploadReservationInput
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			reserved = arg.UsedBytes
			return nil
		},
		createUploadReservationFunc: func(ctx context.Context, arg CreateDeveloperFileUploadReservationInput) (DeveloperFileUploadReservationRecord, error) {
			reservation = arg
			return DeveloperFileUploadReservationRecord{
				FileID:        arg.FileID,
				UserID:        arg.UserID,
				BlobPath:      arg.BlobPath,
				ReservedBytes: arg.ReservedBytes,
				ExpiresAt:     arg.ExpiresAt,
			}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	body := bytes.NewBufferString(`{"filename":"big.pdf","mime_type":"application/pdf","purpose":"assistants"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", body)
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, int64(MaxFileSize), reserved)
	assert.True(t, strings.HasPrefix(reservation.FileID, "file-"))
	assert.Equal(t, int32(1), reservation.UserID)
	assert.Contains(t, reservation.BlobPath, reservation.FileID)
	assert.Equal(t, int64(MaxFileSize), reservation.ReservedBytes)
	assert.True(t, reservation.ExpiresAt.Valid)
}

func TestCreateUploadToken_QuotaExceeded(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	q := &mockFilesQueries{
		reserveFunc: func(ctx context.Context, arg StorageQuotaUpdateInput) error {
			assert.Equal(t, int64(MaxFileSize), arg.UsedBytes)
			return pgx.ErrNoRows
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupFilesRouter(user, q)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/files/upload-token", bytes.NewReader([]byte(`{"filename":"notes.txt","mime_type":"text/plain"}`)))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}
