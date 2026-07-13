package files

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
)

func CreateGeneratedFile(ctx context.Context, q FilesQueries, input CreateGeneratedFileInput) (FileRecord, error) {
	userID, err := requireUserID(input.UserID, "generated file upload")
	if err != nil {
		return FileRecord{}, err
	}
	filename := sanitizeFilename(input.Filename)
	content := input.Content
	written := int64(len(content))
	if written == 0 {
		return FileRecord{}, huma.Error400BadRequest("Generated file is empty")
	}
	if written > MaxFileSize {
		return FileRecord{}, huma.Error400BadRequest(fmt.Sprintf("File exceeds maximum size of %d bytes", MaxFileSize))
	}
	mimeType := strings.TrimSpace(input.MimeType)
	if mimeType == "" {
		mimeType = detectMimeType(content)
	}
	if !allowedGeneratedMimeType(mimeType) {
		return FileRecord{}, huma.NewError(http.StatusUnsupportedMediaType, fmt.Sprintf("Unsupported file type: %s", mimeType))
	}
	purpose := strings.TrimSpace(input.Purpose)
	if purpose == "" {
		purpose = "assistants"
	}

	if err := reserveUserStorage(ctx, q, userID, input.UserID, written, "generated file upload"); err != nil {
		return FileRecord{}, err
	}
	releaseQuota := func() { releaseUserStorage(ctx, q, userID, input.UserID, written) }

	fileID := "file-" + uuid.New().String()
	token, err := blobReadWriteToken()
	if err != nil {
		if localGeneratedFileStorageEnabled() {
			storeLocalGeneratedBlob(fileID, localGeneratedBlob{
				UserID:   userID,
				Content:  content,
				Filename: filename,
				MimeType: mimeType,
			})
			fileRow, err := q.CreateDeveloperFile(ctx, CreateDeveloperFileInput{
				ID:             fileID,
				UserID:         userID,
				OrganizationID: input.OrganizationID,
				Filename:       filename,
				Purpose:        purpose,
				MimeType:       mimeType,
				Bytes:          written,
				BlobURL:        localGeneratedBlobURL(fileID),
				BlobPath:       fileID,
			})
			if err != nil {
				deleteLocalGeneratedBlob(localGeneratedBlobURL(fileID))
				releaseQuota()
				slog.Error("Failed to create local generated file metadata", "userId", input.UserID, "fileId", fileID, "error", err)
				return FileRecord{}, huma.Error500InternalServerError("Storage metadata error")
			}
			return toFileRecord(fileRow), nil
		}
		releaseQuota()
		return FileRecord{}, huma.Error500InternalServerError("Storage backend unavailable")
	}
	blobPath := blobPathForFile(input.UserID, fileID, filename)
	client := newBlobClient(token)
	putRes, err := client.Put(ctx, blobPath, bytes.NewReader(content), vercelblob.PutCommandOptions{
		AddRandomSuffix: false,
		ContentType:     mimeType,
		Access:          "private",
	})
	if err != nil {
		releaseQuota()
		slog.Error("Failed to upload generated blob", "userId", input.UserID, "fileId", fileID, "error", err)
		return FileRecord{}, huma.Error500InternalServerError("Storage error")
	}

	fileRow, err := q.CreateDeveloperFile(ctx, CreateDeveloperFileInput{
		ID:             fileID,
		UserID:         userID,
		OrganizationID: input.OrganizationID,
		Filename:       filename,
		Purpose:        purpose,
		MimeType:       mimeType,
		Bytes:          written,
		BlobURL:        putRes.URL,
		BlobPath:       putRes.Pathname,
	})
	if err != nil {
		if deleteErr := client.Delete(ctx, putRes.URL); deleteErr != nil {
			slog.Warn("Failed to cleanup generated blob after DB failure", "userId", input.UserID, "fileId", fileID, "error", deleteErr)
		}
		releaseQuota()
		slog.Error("Failed to create generated file metadata", "userId", input.UserID, "fileId", fileID, "error", err)
		return FileRecord{}, huma.Error500InternalServerError("Storage metadata error")
	}

	return toFileRecord(fileRow), nil
}
