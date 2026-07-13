package files

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
)

func registerStorageSummaryHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-storage-summary",
		Method:      http.MethodGet,
		Path:        "/api/v1/developer/storage",
		Summary:     "Get storage usage summary",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct {
		Body StorageSummaryResponse
	}, error) {
		userID, err := requireUserID(input.User.ID, "storage summary")
		if err != nil {
			return nil, err
		}
		if err := q.EnsureUserStorageQuota(ctx, userID); err != nil {
			slog.Error("Failed to ensure user storage quota for summary", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Storage quota unavailable")
		}
		releaseExpiredUploadReservations(ctx, q, userID, input.User.ID)

		quota, err := q.GetUserStorageQuota(ctx, userID)
		if err != nil {
			slog.Error("Failed to fetch user storage quota", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Storage quota unavailable")
		}
		stats, err := q.GetDeveloperFileStorageStatsByUser(ctx, userID)
		if err != nil {
			slog.Error("Failed to fetch developer file storage stats", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to load storage usage")
		}

		categories := storageCategoriesFromStats(stats, quota.UsedBytes)
		return &struct {
			Body StorageSummaryResponse
		}{Body: StorageSummaryResponse{
			UsedBytes:  quota.UsedBytes,
			QuotaBytes: quota.QuotaBytes,
			Categories: categories,
		}}, nil
	})
}

func storageCategoriesFromStats(stats []DeveloperFileStorageStatsRecord, usedBytes int64) []StorageCategory {
	statsByCategory := map[string]DeveloperFileStorageStatsRecord{}
	var completedBytes int64
	for _, stat := range stats {
		if stat.Bytes < 0 || stat.Count < 0 {
			continue
		}
		statsByCategory[stat.Category] = stat
		completedBytes += stat.Bytes
	}

	categoryOrder := []StorageCategory{
		{ID: "files", Label: "Files"},
		{ID: "images", Label: "Images"},
		{ID: "generated_artifacts", Label: "Generated artifacts"},
	}
	categories := make([]StorageCategory, 0, len(categoryOrder)+1)
	for _, category := range categoryOrder {
		stat := statsByCategory[category.ID]
		categories = append(categories, StorageCategory{
			ID:    category.ID,
			Label: category.Label,
			Bytes: stat.Bytes,
			Count: stat.Count,
		})
	}
	if reservedBytes := usedBytes - completedBytes; reservedBytes > 0 {
		categories = append(categories, StorageCategory{
			ID:    "pending_uploads",
			Label: "Pending uploads",
			Bytes: reservedBytes,
			Count: 0,
		})
	}
	return categories
}

func registerListFilesHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-list-files",
		Method:      http.MethodGet,
		Path:        "/api/v1/developer/files",
		Summary:     "List files",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
		Limit  int32 `query:"limit" default:"20" minimum:"1" maximum:"100"`
		Offset int32 `query:"offset" default:"0" minimum:"0"`
	}) (*struct {
		Body FileListResponse
	}, error) {
		userID, err := requireUserID(input.User.ID, "list files")
		if err != nil {
			return nil, err
		}
		limit, offset := normalizePagination(input.Limit, input.Offset)
		files, err := q.ListDeveloperFilesByUser(ctx, ListDeveloperFilesInput{
			UserID: userID,
			Limit:  limit,
			Offset: offset,
		})
		if err != nil {
			slog.Error("Failed to list developer files", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to list files")
		}
		total, err := q.CountDeveloperFilesByUser(ctx, userID)
		if err != nil {
			slog.Error("Failed to count developer files", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to list files")
		}

		return &struct {
			Body FileListResponse
		}{Body: FileListResponse{Files: collections.Map(files, toFileRecord), Total: total}}, nil
	})
}

func registerGetFileHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-get-file",
		Method:      http.MethodGet,
		Path:        "/api/v1/developer/files/{fileId}",
		Summary:     "Get file metadata",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
		FileID string `path:"fileId"`
	}) (*struct {
		Body FileRecord
	}, error) {
		userID, err := requireUserID(input.User.ID, "get file")
		if err != nil {
			return nil, err
		}
		fileRow, err := getDeveloperFileForUser(ctx, q, input.FileID, userID, input.User.ID, "get file")
		if err != nil {
			return nil, err
		}
		return &struct{ Body FileRecord }{Body: toFileRecord(fileRow)}, nil
	})
}

func registerDownloadFileHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-download-file",
		Method:      http.MethodGet,
		Path:        "/api/v1/developer/files/{fileId}/content",
		Summary:     "Download file content",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
		Responses: map[string]*huma.Response{
			"200": {
				Description: "File content",
				Content: map[string]*huma.MediaType{
					"application/octet-stream": {
						Schema: &huma.Schema{Type: "string", Format: "binary"},
					},
				},
			},
		},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
		FileID      string `path:"fileId"`
		Disposition string `query:"disposition" enum:"attachment,inline" doc:"Content disposition mode"`
	}) (*fileContentResponse, error) {
		userID, err := requireUserID(input.User.ID, "download file")
		if err != nil {
			return nil, err
		}
		fileRow, err := getDeveloperFileForUser(ctx, q, input.FileID, userID, input.User.ID, "download file")
		if err != nil {
			return nil, err
		}
		if fileRow.Bytes > 0 && server.BinaryPayloadExceedsVercelLimit(fileRow.Bytes) {
			return nil, server.PayloadTooLargeError("File is too large for inline download")
		}

		if blob, ok := loadLocalGeneratedBlob(fileRow.BlobURL, userID); ok {
			if server.BinaryPayloadExceedsVercelLimit(int64(len(blob.Content))) {
				return nil, server.PayloadTooLargeError("File is too large for inline download")
			}
			contentType := strings.TrimSpace(blob.MimeType)
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			headers := server.BuildBinaryDownloadHeaders(contentType, input.Disposition, sanitizeFilename(blob.Filename))
			return &fileContentResponse{
				ContentType:        contentType,
				ContentLength:      strconv.Itoa(len(blob.Content)),
				ContentDisposition: headers.ContentDisposition,
				ContentSecurity:    headers.ContentSecurityPolicy,
				ContentTypeOptions: "nosniff",
				FrameOptions:       headers.FrameOptions,
				Body:               blob.Content,
			}, nil
		}

		token := os.Getenv("BLOB_READ_WRITE_TOKEN")
		if token == "" {
			return nil, huma.Error500InternalServerError("Storage backend unavailable")
		}
		client := newBlobClient(token)
		headPath := developerFileBlobHeadPath(fileRow)
		head, err := client.Head(ctx, headPath)
		if err != nil {
			if errors.Is(err, vercelblob.ErrBlobNotFound) {
				return nil, huma.Error404NotFound("File content not found")
			}
			slog.ErrorContext(ctx, "inspect developer file blob", "error", err, "file_id", fileRow.ID)
			return nil, huma.Error500InternalServerError("Failed to download file")
		}
		if head != nil && head.Size > uint64(server.VercelFunctionSafeBinaryPayloadBytes) {
			return nil, server.PayloadTooLargeError("File is too large for inline download")
		}

		content, err := client.Download(ctx, fileRow.BlobURL, vercelblob.DownloadCommandOptions{})
		if err != nil {
			if errors.Is(err, vercelblob.ErrBlobNotFound) {
				return nil, huma.Error404NotFound("File content not found")
			}
			slog.ErrorContext(ctx, "download developer file blob", "error", err, "file_id", fileRow.ID)
			return nil, huma.Error500InternalServerError("Failed to download file")
		}
		if server.BinaryPayloadExceedsVercelLimit(int64(len(content))) {
			return nil, server.PayloadTooLargeError("File is too large for inline download")
		}

		contentType := strings.TrimSpace(fileRow.MimeType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		headers := server.BuildBinaryDownloadHeaders(contentType, input.Disposition, sanitizeFilename(fileRow.Filename))
		return &fileContentResponse{
			ContentType:        contentType,
			ContentLength:      strconv.Itoa(len(content)),
			ContentDisposition: headers.ContentDisposition,
			ContentSecurity:    headers.ContentSecurityPolicy,
			ContentTypeOptions: "nosniff",
			FrameOptions:       headers.FrameOptions,
			Body:               content,
		}, nil
	})
}

func developerFileBlobHeadPath(fileRow DeveloperFileRecord) string {
	path := strings.TrimSpace(fileRow.BlobPath)
	if path != "" {
		return path
	}
	return normalizeBlobPathname(fileRow.BlobURL)
}

func registerDeleteFileHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-delete-file",
		Method:      http.MethodDelete,
		Path:        "/api/v1/developer/files/{fileId}",
		Summary:     "Delete file",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
		FileID string `path:"fileId"`
	}) (*struct {
		Body deleteFileResponse
	}, error) {
		userID, err := requireUserID(input.User.ID, "delete file")
		if err != nil {
			return nil, err
		}
		fileRow, err := q.MarkDeveloperFileDeleted(ctx, DeveloperFileLookupInput{
			ID:     input.FileID,
			UserID: userID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound("File not found")
			}
			slog.Error("Failed to mark developer file as deleted", "userId", input.User.ID, "fileId", input.FileID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete file")
		}

		if strings.HasPrefix(fileRow.BlobURL, localGeneratedBlobURLPrefix) {
			deleteLocalGeneratedBlob(fileRow.BlobURL)
			if err := q.ReleaseUserStorageBytes(ctx, StorageQuotaUpdateInput{
				UserID:    userID,
				UsedBytes: fileRow.Bytes,
			}); err != nil {
				slog.Error("Failed to release used storage after local generated file deletion", "userId", input.User.ID, "fileId", input.FileID, "bytes", fileRow.Bytes, "error", err)
			}
			return &struct {
				Body deleteFileResponse
			}{Body: deleteFileResponse{ID: input.FileID, Deleted: true}}, nil
		}

		token, err := blobReadWriteToken()
		if err != nil {
			if restoreErr := q.RestoreDeveloperFileDeletion(ctx, DeveloperFileLookupInput{
				ID:     input.FileID,
				UserID: userID,
			}); restoreErr != nil {
				slog.Error("Failed to restore file deletion flag after storage token failure", "userId", input.User.ID, "fileId", input.FileID, "error", restoreErr)
			}
			return nil, huma.Error500InternalServerError("Storage backend unavailable")
		}
		client := newBlobClient(token)
		if err := client.Delete(ctx, fileRow.BlobURL); err != nil {
			restoreErr := q.RestoreDeveloperFileDeletion(ctx, DeveloperFileLookupInput{
				ID:     input.FileID,
				UserID: userID,
			})
			if restoreErr != nil {
				slog.Error("Failed to restore file deletion flag after blob delete failure", "userId", input.User.ID, "fileId", input.FileID, "error", restoreErr)
			}
			slog.Error("Failed to delete blob", "userId", input.User.ID, "fileId", input.FileID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete file from storage")
		}

		if err := q.ReleaseUserStorageBytes(ctx, StorageQuotaUpdateInput{
			UserID:    userID,
			UsedBytes: fileRow.Bytes,
		}); err != nil {
			slog.Error("Failed to release used storage after file deletion", "userId", input.User.ID, "fileId", input.FileID, "bytes", fileRow.Bytes, "error", err)
		}

		return &struct {
			Body deleteFileResponse
		}{Body: deleteFileResponse{ID: input.FileID, Deleted: true}}, nil
	})
}
