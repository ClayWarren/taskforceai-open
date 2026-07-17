package files

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TaskForceAI/adapters/pkg/convert"
	corefiles "github.com/TaskForceAI/core/pkg/files"
)

const (
	// MaxFileSize is the maximum allowed file size (10MB)
	MaxFileSize = corefiles.MaxUploadSizeBytes
	// DefaultUserStorageQuotaBytes configures the default per-user storage budget.
	DefaultUserStorageQuotaBytes = corefiles.DefaultUserStorageQuotaBytes
	// defaultListLimit is the default number of file records returned by list.
	defaultListLimit = 20
	// maxListLimit is the maximum number of file records returned by list.
	maxListLimit = 100
	// uploadTokenTTL is the lifetime of direct-upload tokens.
	uploadTokenTTL = 15 * time.Minute
	// localGeneratedBlobURLPrefix marks development-only in-memory generated file storage.
	localGeneratedBlobURLPrefix = "local-generated://"
)

type localGeneratedBlob struct {
	UserID   int32
	Content  []byte
	Filename string
	MimeType string
}

var localGeneratedBlobs = struct {
	sync.RWMutex
	files map[string]localGeneratedBlob
}{
	files: make(map[string]localGeneratedBlob),
}

type FileRecord struct {
	ID        string `json:"id"`
	Object    string `json:"object"`
	Bytes     int64  `json:"bytes"`
	CreatedAt int64  `json:"created_at"`
	Filename  string `json:"filename"`
	Purpose   string `json:"purpose"`
	MimeType  string `json:"mime_type,omitempty"`
}

type FileListResponse struct {
	Files []FileRecord `json:"files"`
	Total int64        `json:"total"`
}

type StorageCategory struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Bytes int64  `json:"bytes"`
	Count int64  `json:"count"`
}

type StorageSummaryResponse struct {
	UsedBytes  int64             `json:"usedBytes"`
	QuotaBytes int64             `json:"quotaBytes"`
	Categories []StorageCategory `json:"categories"`
}

// fileContentResponse streams private blob content through the authenticated API.
type fileContentResponse struct {
	ContentType        string `header:"Content-Type"`
	ContentLength      string `header:"Content-Length"`
	ContentDisposition string `header:"Content-Disposition"`
	ContentSecurity    string `header:"Content-Security-Policy"`
	ContentTypeOptions string `header:"X-Content-Type-Options"`
	FrameOptions       string `header:"X-Frame-Options"`
	Body               []byte
}

type deleteFileResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

func localGeneratedFileStorageEnabled() bool {
	switch strings.TrimSpace(strings.ToLower(os.Getenv("TASKFORCE_LOCAL_TASK_EXECUTION"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func localGeneratedBlobURL(fileID string) string {
	return localGeneratedBlobURLPrefix + fileID
}

func storeLocalGeneratedBlob(fileID string, blob localGeneratedBlob) {
	localGeneratedBlobs.Lock()
	defer localGeneratedBlobs.Unlock()
	content := make([]byte, len(blob.Content))
	copy(content, blob.Content)
	blob.Content = content
	localGeneratedBlobs.files[fileID] = blob
}

func loadLocalGeneratedBlob(blobURL string, userID int32) (localGeneratedBlob, bool) {
	fileID, ok := strings.CutPrefix(blobURL, localGeneratedBlobURLPrefix)
	if !ok || fileID == "" {
		return localGeneratedBlob{}, false
	}
	localGeneratedBlobs.RLock()
	blob, found := localGeneratedBlobs.files[fileID]
	localGeneratedBlobs.RUnlock()
	if !found || blob.UserID != userID {
		return localGeneratedBlob{}, false
	}
	content := make([]byte, len(blob.Content))
	copy(content, blob.Content)
	blob.Content = content
	return blob, true
}

func deleteLocalGeneratedBlob(blobURL string) {
	fileID, ok := strings.CutPrefix(blobURL, localGeneratedBlobURLPrefix)
	if !ok || fileID == "" {
		return
	}
	localGeneratedBlobs.Lock()
	delete(localGeneratedBlobs.files, fileID)
	localGeneratedBlobs.Unlock()
}

type uploadTokenRequest struct {
	Filename string `json:"filename" required:"true"`
	Purpose  string `json:"purpose,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
}

type CreateGeneratedFileInput struct {
	UserID         int
	OrganizationID *int32
	Filename       string
	Purpose        string
	MimeType       string
	Content        []byte
}

type uploadTokenResponse struct {
	FileID      string `json:"file_id"`
	UploadURL   string `json:"upload_url"`
	UploadToken string `json:"upload_token"`
	Pathname    string `json:"pathname"`
	ExpiresAt   int64  `json:"expires_at"`
	MaxBytes    int64  `json:"max_bytes"`
}

type completeUploadRequest struct {
	FileID   string `json:"file_id" required:"true"`
	Pathname string `json:"pathname" required:"true"`
	Filename string `json:"filename" required:"true"`
	Purpose  string `json:"purpose,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
}

type blobClient interface {
	Put(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error)
	Head(ctx context.Context, pathname string) (*vercelblob.HeadBlobResult, error)
	Download(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error)
	Delete(ctx context.Context, urls ...string) error
}

type envTokenProvider struct{ token string }

func (p *envTokenProvider) GetToken(_, _ string) (string, error) { return p.token, nil }

var newBlobClient = func(token string) blobClient {
	return vercelblob.NewClientExternal(&envTokenProvider{token: token})
}

var generateBlobClientToken = vercelblob.GenerateClientToken

var errBlobReadWriteTokenMissing = errors.New("blob read-write token missing")

var nowUnix = func() int64 {
	return time.Now().Unix()
}

type FilesQueries interface {
	EnsureUserStorageQuota(ctx context.Context, userID int32) error
	GetUserStorageQuota(ctx context.Context, userID int32) (StorageQuotaRecord, error)
	ReserveUserStorageBytes(ctx context.Context, arg StorageQuotaUpdateInput) error
	ReleaseUserStorageBytes(ctx context.Context, arg StorageQuotaUpdateInput) error
	CreateDeveloperFileUploadReservation(ctx context.Context, arg CreateDeveloperFileUploadReservationInput) (DeveloperFileUploadReservationRecord, error)
	ConsumeDeveloperFileUploadReservation(ctx context.Context, arg DeveloperFileUploadReservationLookupInput) (DeveloperFileUploadReservationRecord, error)
	ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error)
	CreateDeveloperFile(ctx context.Context, arg CreateDeveloperFileInput) (DeveloperFileRecord, error)
	GetDeveloperFileByIDForUser(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error)
	ListDeveloperFilesByUser(ctx context.Context, arg ListDeveloperFilesInput) ([]DeveloperFileRecord, error)
	CountDeveloperFilesByUser(ctx context.Context, userID int32) (int64, error)
	GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]DeveloperFileStorageStatsRecord, error)
	MarkDeveloperFileDeleted(ctx context.Context, arg DeveloperFileLookupInput) (DeveloperFileRecord, error)
	RestoreDeveloperFileDeletion(ctx context.Context, arg DeveloperFileLookupInput) error
}

type StorageQuotaRecord struct {
	UserID     int32
	QuotaBytes int64
	UsedBytes  int64
}

type DeveloperFileStorageStatsRecord struct {
	Category string
	Bytes    int64
	Count    int64
}

type DeveloperFileRecord struct {
	ID        string
	UserID    int32
	Filename  string
	Purpose   string
	MimeType  string
	Bytes     int64
	BlobURL   string
	BlobPath  string
	CreatedAt pgtype.Timestamp
	UpdatedAt pgtype.Timestamp
}

type CreateDeveloperFileInput struct {
	ID             string
	UserID         int32
	OrganizationID *int32
	Filename       string
	Purpose        string
	MimeType       string
	Bytes          int64
	BlobURL        string
	BlobPath       string
}

type DeveloperFileLookupInput struct {
	ID     string
	UserID int32
}

type ListDeveloperFilesInput struct {
	UserID int32
	Limit  int32
	Offset int32
}

type StorageQuotaUpdateInput struct {
	UserID    int32
	UsedBytes int64
}

type CreateDeveloperFileUploadReservationInput struct {
	FileID        string
	UserID        int32
	BlobPath      string
	ReservedBytes int64
	ExpiresAt     pgtype.Timestamp
}

type DeveloperFileUploadReservationLookupInput struct {
	FileID   string
	UserID   int32
	BlobPath string
}

type DeveloperFileUploadReservationRecord struct {
	FileID        string
	UserID        int32
	BlobPath      string
	ReservedBytes int64
	ExpiresAt     pgtype.Timestamp
	CompletedAt   pgtype.Timestamp
	CreatedAt     pgtype.Timestamp
	UpdatedAt     pgtype.Timestamp
}

func normalizePagination(limit, offset int32) (int32, int32) {
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func sanitizeFilename(filename string) string {
	base := filepath.Base(strings.TrimSpace(filename))
	if base == "" || base == "." {
		return "file.bin"
	}
	var b strings.Builder
	for _, r := range base {
		if r > unicode.MaxASCII {
			b.WriteByte('_')
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
			continue
		}
		b.WriteByte('_')
	}
	safe := strings.TrimSpace(b.String())
	return safe
}

func blobPathForFile(userID int, fileID, filename string) string {
	return fmt.Sprintf("developer-files/u%d/%s/%s", userID, fileID, sanitizeFilename(filename))
}

func blobFinalPathForFile(userID int, fileID, filename string) string {
	return fmt.Sprintf("developer-files/u%d/%s/final/%s", userID, fileID, sanitizeFilename(filename))
}

func blobPathPrefixForFile(userID int, fileID string) string {
	return fmt.Sprintf("developer-files/u%d/%s/", userID, fileID)
}

func normalizeBlobPathname(pathname string) string {
	trimmed := strings.TrimSpace(pathname)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		parsed, err := url.Parse(trimmed)
		if err == nil {
			return strings.TrimPrefix(parsed.Path, "/")
		}
	}
	return strings.TrimPrefix(trimmed, "/")
}

func blobAPIBaseURL() string {
	base := strings.TrimSpace(os.Getenv("VERCEL_BLOB_API_URL"))
	if base == "" {
		base = vercelblob.DefaultBaseURL
	}
	return strings.TrimRight(base, "/")
}

func blobReadWriteToken() (string, error) {
	token := strings.TrimSpace(os.Getenv("BLOB_READ_WRITE_TOKEN"))
	if token == "" {
		return "", errBlobReadWriteTokenMissing
	}
	return token, nil
}

func allowedMimeType(mimeType string) bool {
	return corefiles.IsAllowedUploadMIMEType(mimeType)
}

func allowedGeneratedMimeType(mimeType string) bool {
	return corefiles.IsAllowedStoredMIMEType(mimeType)
}

func toFileRecord(file DeveloperFileRecord) FileRecord {
	return FileRecord{
		ID:        file.ID,
		Object:    "file",
		Bytes:     file.Bytes,
		CreatedAt: unixFromTimestamp(file.CreatedAt),
		Filename:  file.Filename,
		Purpose:   file.Purpose,
		MimeType:  file.MimeType,
	}
}

func unixFromTimestamp(ts pgtype.Timestamp) int64 {
	if ts.Valid {
		return ts.Time.Unix()
	}
	return nowUnix()
}

func requireUserID(userID int, operation string) (int32, error) {
	id, err := convert.Int32(userID, "user_id")
	if err != nil {
		slog.Error("Invalid user id for "+operation, "userId", userID, "error", err)
		return 0, huma.Error500InternalServerError("Invalid user identifier")
	}
	return id, nil
}

func reserveUserStorage(ctx context.Context, q FilesQueries, userID int32, logUserID int, bytes int64, operation string) error {
	if err := q.EnsureUserStorageQuota(ctx, userID); err != nil {
		slog.Error("Failed to ensure user storage quota", "operation", operation, "userId", logUserID, "error", err)
		return huma.Error500InternalServerError("Storage quota unavailable")
	}
	err := q.ReserveUserStorageBytes(ctx, StorageQuotaUpdateInput{
		UserID:    userID,
		UsedBytes: bytes,
	})
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return huma.NewError(http.StatusForbidden, "Storage quota exceeded")
	}
	slog.Error("Failed to reserve user storage quota", "operation", operation, "userId", logUserID, "bytes", bytes, "error", err)
	return huma.Error500InternalServerError("Storage quota unavailable")
}

func releaseUserStorage(ctx context.Context, q FilesQueries, userID int32, logUserID int, bytes int64) {
	if bytes <= 0 {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if releaseErr := q.ReleaseUserStorageBytes(cleanupCtx, StorageQuotaUpdateInput{
		UserID:    userID,
		UsedBytes: bytes,
	}); releaseErr != nil {
		slog.Error("Failed to release reserved storage quota", "userId", logUserID, "bytes", bytes, "error", releaseErr)
	}
}

func releaseExpiredUploadReservations(ctx context.Context, q FilesQueries, userID int32, logUserID int) {
	_, err := q.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, userID)
	if err != nil {
		slog.Error("Failed to release expired upload reservations", "userId", logUserID, "error", err)
	}
}

func getDeveloperFileForUser(ctx context.Context, q FilesQueries, fileID string, userID int32, logUserID int, operation string) (DeveloperFileRecord, error) {
	fileRow, err := q.GetDeveloperFileByIDForUser(ctx, DeveloperFileLookupInput{
		ID:     fileID,
		UserID: userID,
	})
	if err == nil {
		return fileRow, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return DeveloperFileRecord{}, huma.Error404NotFound("File not found")
	}
	slog.Error("Failed to fetch developer file", "operation", operation, "userId", logUserID, "fileId", fileID, "error", err)
	return DeveloperFileRecord{}, huma.Error500InternalServerError("Failed to fetch file")
}

func detectMimeType(content []byte) string {
	detectLen := min(len(content), 512)
	mimeType := http.DetectContentType(content[:detectLen])
	if idx := strings.Index(mimeType, ";"); idx != -1 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	return mimeType
}

func resolveOptionalOrgID(userOrgID *int, authOrgID int) (*int32, error) {
	switch {
	case userOrgID != nil:
		id, err := convert.Int32(*userOrgID, "organization_id")
		if err != nil {
			return nil, err
		}
		return &id, nil
	case authOrgID > 0:
		id, err := convert.Int32(authOrgID, "organization_id")
		if err != nil {
			return nil, err
		}
		return &id, nil
	default:
		return nil, nil //nolint:nilnil // A missing organization is a valid optional value.
	}
}
