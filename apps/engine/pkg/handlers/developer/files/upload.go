package files

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TaskForceAI/adapters/pkg/handler"
)

func registerUploadFileHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-upload-file",
		Method:      http.MethodPost,
		Path:        "/api/v1/developer/files",
		Summary:     "Upload a file",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *struct {
		// Multipart is handled via the context
		handler.AuthContext
		RawBody huma.MultipartFormFiles[uploadFileFormData]
	}) (*uploadFileResponse, error) {
		form := input.RawBody.Form
		if form != nil {
			defer func() { _ = form.RemoveAll() }()
		}
		return handleUploadFileForm(ctx, q, input.AuthContext, input.RawBody.Data())
	})
}

type uploadFileResponse struct {
	Body FileRecord
}

type uploadFileFormData struct {
	File    huma.FormFile `form:"file"`
	Purpose string        `form:"purpose" required:"false"`
}

func handleUploadFileForm(ctx context.Context, q FilesQueries, authContext handler.AuthContext, formData *uploadFileFormData) (*uploadFileResponse, error) {
	uploadFile, purpose, err := requireUploadFormData(formData)
	if err != nil {
		return nil, err
	}
	defer func() { _ = uploadFile.Close() }()

	record, err := uploadDeveloperFile(ctx, q, uploadDeveloperFileInput{
		AuthContext: authContext,
		File:        uploadFile,
		Purpose:     purpose,
	})
	if err != nil {
		return nil, err
	}
	return &uploadFileResponse{Body: record}, nil
}

func requireUploadFormData(formData *uploadFileFormData) (huma.FormFile, string, error) {
	if formData == nil {
		return huma.FormFile{}, "", missingUploadFileError()
	}
	uploadFile, err := requireUploadFormFile(formData.File)
	if err != nil {
		return huma.FormFile{}, "", err
	}
	return uploadFile, formData.Purpose, nil
}

func requireUploadFormFile(file huma.FormFile) (huma.FormFile, error) {
	if !file.IsSet || file.File == nil {
		return huma.FormFile{}, missingUploadFileError()
	}
	return file, nil
}

func missingUploadFileError() error {
	return huma.Error400BadRequest("Missing file")
}

type uploadDeveloperFileInput struct {
	handler.AuthContext
	File    huma.FormFile
	Purpose string
}

func uploadDeveloperFile(ctx context.Context, q FilesQueries, input uploadDeveloperFileInput) (FileRecord, error) {
	userID, err := requireUserID(input.User.ID, "file upload")
	if err != nil {
		return FileRecord{}, err
	}

	purpose := "assistants"
	if input.Purpose != "" {
		purpose = input.Purpose
	}

	content, err := readUploadFileContent(input.File)
	if err != nil {
		return FileRecord{}, err
	}
	written := int64(len(content))
	if written > MaxFileSize {
		return FileRecord{}, huma.Error400BadRequest(fmt.Sprintf("File exceeds maximum size of %d bytes", MaxFileSize))
	}
	if written == 0 {
		return FileRecord{}, huma.Error400BadRequest("Uploaded file is empty")
	}
	detectedType := detectMimeType(content)
	if !allowedMimeType(detectedType) {
		return FileRecord{}, huma.NewError(http.StatusUnsupportedMediaType,
			fmt.Sprintf("Unsupported file type: %s", detectedType))
	}

	if err := reserveUserStorage(ctx, q, userID, input.User.ID, written, "file upload"); err != nil {
		return FileRecord{}, err
	}
	releaseQuota := func() { releaseUserStorage(ctx, q, userID, input.User.ID, written) }

	token, err := blobReadWriteToken()
	if err != nil {
		releaseQuota()
		return FileRecord{}, huma.Error500InternalServerError("Storage backend unavailable")
	}
	fileID := "file-" + uuid.New().String()
	blobPath := blobPathForFile(input.User.ID, fileID, input.File.Filename)
	client := newBlobClient(token)
	putRes, err := client.Put(ctx, blobPath, bytes.NewReader(content), vercelblob.PutCommandOptions{
		AddRandomSuffix: false,
		ContentType:     detectedType,
		Access:          "private",
	})
	if err != nil {
		releaseQuota()
		slog.Error("Failed to upload blob", "userId", input.User.ID, "fileId", fileID, "error", err)
		return FileRecord{}, huma.Error500InternalServerError("Storage error")
	}

	orgID, err := resolveOptionalOrgID(input.User.OrgID, input.OrgID)
	if err != nil {
		if deleteErr := client.Delete(ctx, putRes.URL); deleteErr != nil {
			slog.Warn("Failed to cleanup blob after invalid org id", "userId", input.User.ID, "fileId", fileID, "error", deleteErr)
		}
		releaseQuota()
		slog.Error("Invalid org id for file upload", "userId", input.User.ID, "orgId", input.OrgID, "error", err)
		return FileRecord{}, huma.Error500InternalServerError("Invalid organization identifier")
	}
	fileRow, err := q.CreateDeveloperFile(ctx, CreateDeveloperFileInput{
		ID:             fileID,
		UserID:         userID,
		OrganizationID: orgID,
		Filename:       input.File.Filename,
		Purpose:        purpose,
		MimeType:       detectedType,
		Bytes:          written,
		BlobURL:        putRes.URL,
		BlobPath:       putRes.Pathname,
	})
	if err != nil {
		if deleteErr := client.Delete(ctx, putRes.URL); deleteErr != nil {
			slog.Warn("Failed to cleanup blob after DB failure", "userId", input.User.ID, "fileId", fileID, "error", deleteErr)
		}
		releaseQuota()
		slog.Error("Failed to create developer file metadata", "userId", input.User.ID, "fileId", fileID, "error", err)
		return FileRecord{}, huma.Error500InternalServerError("Storage metadata error")
	}

	return toFileRecord(fileRow), nil
}

func readUploadFileContent(file io.Reader) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(file, MaxFileSize+1))
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to read file")
	}
	return content, nil
}

func registerCreateUploadTokenHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-create-upload-token",
		Method:      http.MethodPost,
		Path:        "/api/v1/developer/files/upload-token",
		Summary:     "Create direct upload token",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
		Body uploadTokenRequest
	}) (*struct {
		Body uploadTokenResponse
	}, error) {
		userID, err := requireUserID(input.User.ID, "creating upload token")
		if err != nil {
			return nil, err
		}
		filename := strings.TrimSpace(input.Body.Filename)
		if filename == "" {
			return nil, huma.Error400BadRequest("filename is required")
		}
		mimeType := strings.TrimSpace(input.Body.MimeType)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		if !allowedMimeType(mimeType) {
			return nil, huma.NewError(http.StatusUnsupportedMediaType, fmt.Sprintf("Unsupported file type: %s", mimeType))
		}

		releaseExpiredUploadReservations(ctx, q, userID, input.User.ID)
		token, err := blobReadWriteToken()
		if err != nil {
			return nil, huma.Error500InternalServerError("Storage backend unavailable")
		}
		fileID := "file-" + uuid.New().String()
		pathname := blobPathForFile(input.User.ID, fileID, filename)
		expiresAt := time.Now().Add(uploadTokenTTL).Unix()
		uploadToken, err := generateBlobClientToken(token, vercelblob.ClientTokenOptions{
			Operation: "put",
			Pathname:  pathname,
			ExpiresAt: expiresAt,
		})
		if err != nil {
			slog.Error("Failed to generate blob client upload token", "userId", input.User.ID, "fileId", fileID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to create upload token")
		}
		if err := reserveUserStorage(ctx, q, userID, input.User.ID, MaxFileSize, "create direct upload token"); err != nil {
			return nil, err
		}
		_, err = q.CreateDeveloperFileUploadReservation(ctx, CreateDeveloperFileUploadReservationInput{
			FileID:        fileID,
			UserID:        userID,
			BlobPath:      pathname,
			ReservedBytes: MaxFileSize,
			ExpiresAt: pgtype.Timestamp{
				Time:  time.Unix(expiresAt, 0),
				Valid: true,
			},
		})
		if err != nil {
			releaseUserStorage(ctx, q, userID, input.User.ID, MaxFileSize)
			slog.Error("Failed to create direct upload reservation", "userId", input.User.ID, "fileId", fileID, "error", err)
			return nil, huma.Error500InternalServerError("Storage quota unavailable")
		}

		return &struct {
			Body uploadTokenResponse
		}{
			Body: uploadTokenResponse{
				FileID:      fileID,
				UploadURL:   blobAPIBaseURL() + "/" + pathname,
				UploadToken: uploadToken,
				Pathname:    pathname,
				ExpiresAt:   expiresAt,
				MaxBytes:    MaxFileSize,
			},
		}, nil
	})
}

type completeUploadInput struct {
	handler.AuthContext
	Body completeUploadRequest
}

type completeUploadOutput struct {
	Body FileRecord
}

func registerCompleteUploadHandler(api huma.API, q FilesQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "developer-complete-upload",
		Method:      http.MethodPost,
		Path:        "/api/v1/developer/files/complete",
		Summary:     "Complete direct upload",
		Tags:        []string{"Developer"},
		Security:    []map[string][]string{{"api_key": {}}},
	}, func(ctx context.Context, input *completeUploadInput) (*completeUploadOutput, error) {
		return completeUpload(ctx, q, input)
	})
}

func completeUpload(ctx context.Context, q FilesQueries, input *completeUploadInput) (*completeUploadOutput, error) {
	validated, err := validateCompleteUpload(ctx, q, input)
	if err != nil {
		return nil, err
	}
	userID, fileID, filename, pathname := validated.userID, validated.fileID, validated.filename, validated.pathname
	reservation := validated.reservation
	releaseReservedBytes := func(bytes int64) {
		releaseUserStorage(ctx, q, userID, input.User.ID, bytes)
	}

	token, err := blobReadWriteToken()
	if err != nil {
		releaseReservedBytes(reservation.ReservedBytes)
		return nil, huma.Error500InternalServerError("Storage backend unavailable")
	}
	client := newBlobClient(token)
	headRes, err := client.Head(ctx, pathname)
	if err != nil {
		if errors.Is(err, vercelblob.ErrBlobNotFound) {
			releaseReservedBytes(reservation.ReservedBytes)
			return nil, huma.Error404NotFound("Uploaded blob not found")
		}
		releaseReservedBytes(reservation.ReservedBytes)
		slog.Error("Failed to inspect uploaded blob", "userId", input.User.ID, "fileId", fileID, "pathname", pathname, "error", err)
		return nil, huma.Error500InternalServerError("Failed to inspect uploaded file")
	}
	cleanupUploadedBlob := func(reason string) {
		if err := client.Delete(ctx, headRes.URL); err != nil {
			slog.Warn("Failed to clean up rejected direct upload", "userId", input.User.ID, "fileId", fileID, "pathname", pathname, "reason", reason, "error", err)
		}
	}
	if headRes.Size == 0 {
		cleanupUploadedBlob("empty_file")
		releaseReservedBytes(reservation.ReservedBytes)
		return nil, huma.Error400BadRequest("Uploaded file is empty")
	}
	if headRes.Size > uint64(MaxFileSize) {
		cleanupUploadedBlob("file_too_large")
		releaseReservedBytes(reservation.ReservedBytes)
		return nil, huma.Error400BadRequest(fmt.Sprintf("File exceeds maximum size of %d bytes", MaxFileSize))
	}

	content, err := client.Download(ctx, headRes.URL, vercelblob.DownloadCommandOptions{
		ByteRange: &vercelblob.Range{
			Start: 0,
			End:   uint(MaxFileSize),
		},
	})
	if err != nil {
		cleanupUploadedBlob("content_validation_failed")
		releaseReservedBytes(reservation.ReservedBytes)
		slog.Error("Failed to validate uploaded blob content", "userId", input.User.ID, "fileId", fileID, "pathname", pathname, "error", err)
		return nil, huma.Error500InternalServerError("Failed to validate uploaded file")
	}
	mimeType, size, rejectionReason, validationErr := validateDirectUploadContent(content, reservation.ReservedBytes)
	if validationErr != nil {
		cleanupUploadedBlob(rejectionReason)
		releaseReservedBytes(reservation.ReservedBytes)
		return nil, validationErr
	}

	purpose := strings.TrimSpace(input.Body.Purpose)
	if purpose == "" {
		purpose = "assistants"
	}
	orgID, err := resolveOptionalOrgID(input.User.OrgID, input.OrgID)
	if err != nil {
		cleanupUploadedBlob("invalid_org_id")
		releaseReservedBytes(reservation.ReservedBytes)
		slog.Error("Invalid org id for complete upload", "userId", input.User.ID, "orgId", input.OrgID, "error", err)
		return nil, huma.Error500InternalServerError("Invalid organization identifier")
	}

	finalPath := blobFinalPathForFile(input.User.ID, fileID, filename)
	putRes, err := client.Put(ctx, finalPath, bytes.NewReader(content), vercelblob.PutCommandOptions{
		AllowOverwrite: false,
		ContentType:    mimeType,
		Access:         "private",
	})
	if err != nil {
		cleanupUploadedBlob("seal_put_failed")
		releaseReservedBytes(reservation.ReservedBytes)
		slog.Error("Failed to seal direct upload blob", "userId", input.User.ID, "fileId", fileID, "pathname", pathname, "finalPath", finalPath, "error", err)
		return nil, huma.Error500InternalServerError("Failed to seal uploaded file")
	}
	if putRes == nil {
		cleanupUploadedBlob("seal_put_missing_response")
		releaseReservedBytes(reservation.ReservedBytes)
		slog.Error("Sealed direct upload response missing body", "userId", input.User.ID, "fileId", fileID, "finalPath", finalPath)
		return nil, huma.Error500InternalServerError("Failed to seal uploaded file")
	}
	finalURL := strings.TrimSpace(putRes.URL)
	if finalURL == "" {
		releaseReservedBytes(reservation.ReservedBytes)
		cleanupUploadedBlob("seal_put_missing_url")
		if err := client.Delete(ctx, finalPath); err != nil {
			slog.Warn("Failed to clean up sealed direct upload with missing URL", "userId", input.User.ID, "fileId", fileID, "finalPath", finalPath, "error", err)
		}
		slog.Error("Sealed direct upload response missing URL", "userId", input.User.ID, "fileId", fileID, "finalPath", finalPath)
		return nil, huma.Error500InternalServerError("Failed to seal uploaded file")
	}
	finalBlobPath := normalizeBlobPathname(putRes.Pathname)
	if finalBlobPath == "" {
		finalBlobPath = finalPath
	}
	cleanupSealedBlob := func(reason string) {
		if err := client.Delete(ctx, finalURL); err != nil {
			slog.Warn("Failed to clean up sealed direct upload", "userId", input.User.ID, "fileId", fileID, "finalPath", finalBlobPath, "reason", reason, "error", err)
		}
	}
	cleanupUploadedBlob("sealed_upload")

	fileRow, err := q.CreateDeveloperFile(ctx, CreateDeveloperFileInput{
		ID:             fileID,
		UserID:         userID,
		OrganizationID: orgID,
		Filename:       filename,
		Purpose:        purpose,
		MimeType:       mimeType,
		Bytes:          size,
		BlobURL:        finalURL,
		BlobPath:       finalBlobPath,
	})
	if err != nil {
		cleanupSealedBlob("metadata_create_failed")
		releaseReservedBytes(reservation.ReservedBytes)
		slog.Error("Failed to create developer file metadata from direct upload", "userId", input.User.ID, "fileId", fileID, "error", err)
		return nil, huma.Error500InternalServerError("Storage metadata error")
	}
	releaseReservedBytes(reservation.ReservedBytes - size)
	return &completeUploadOutput{Body: toFileRecord(fileRow)}, nil
}

func validateDirectUploadContent(content []byte, reservedBytes int64) (string, int64, string, error) {
	if len(content) == 0 {
		return "", 0, "empty_file", huma.Error400BadRequest("Uploaded file is empty")
	}
	if len(content) > MaxFileSize {
		return "", 0, "file_too_large", huma.Error400BadRequest(fmt.Sprintf("File exceeds maximum size of %d bytes", MaxFileSize))
	}
	mimeType := detectMimeType(content)
	if !allowedMimeType(mimeType) {
		return "", 0, "unsupported_mime_type", huma.NewError(http.StatusUnsupportedMediaType, fmt.Sprintf("Unsupported file type: %s", mimeType))
	}
	size := int64(len(content))
	if size > reservedBytes {
		return "", 0, "exceeds_reserved_size", huma.Error400BadRequest(fmt.Sprintf("File exceeds reserved upload size of %d bytes", reservedBytes))
	}
	return mimeType, size, "", nil
}

type validatedCompleteUpload struct {
	userID      int32
	fileID      string
	filename    string
	pathname    string
	reservation DeveloperFileUploadReservationRecord
}

func validateCompleteUpload(ctx context.Context, q FilesQueries, input *completeUploadInput) (validatedCompleteUpload, error) {
	userID, err := requireUserID(input.User.ID, "completing upload")
	if err != nil {
		return validatedCompleteUpload{}, err
	}
	fileID, filename := strings.TrimSpace(input.Body.FileID), strings.TrimSpace(input.Body.Filename)
	pathname := normalizeBlobPathname(input.Body.Pathname)
	if fileID == "" {
		return validatedCompleteUpload{}, huma.Error400BadRequest("file_id is required")
	}
	if filename == "" {
		return validatedCompleteUpload{}, huma.Error400BadRequest("filename is required")
	}
	if pathname == "" {
		return validatedCompleteUpload{}, huma.Error400BadRequest("pathname is required")
	}
	if !strings.HasPrefix(pathname, blobPathPrefixForFile(input.User.ID, fileID)) {
		return validatedCompleteUpload{}, huma.Error403Forbidden("Invalid upload pathname")
	}
	_, err = q.GetDeveloperFileByIDForUser(ctx, DeveloperFileLookupInput{ID: fileID, UserID: userID})
	if err == nil {
		return validatedCompleteUpload{}, huma.NewError(http.StatusConflict, "File already completed")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("Failed to check existing developer file", "userId", input.User.ID, "fileId", fileID, "error", err)
		return validatedCompleteUpload{}, huma.Error500InternalServerError("Storage metadata error")
	}
	reservation, err := q.ConsumeDeveloperFileUploadReservation(ctx, DeveloperFileUploadReservationLookupInput{FileID: fileID, UserID: userID, BlobPath: pathname})
	if errors.Is(err, pgx.ErrNoRows) {
		releaseExpiredUploadReservations(ctx, q, userID, input.User.ID)
		return validatedCompleteUpload{}, huma.Error403Forbidden("Invalid or expired upload reservation")
	}
	if err != nil {
		slog.Error("Failed to consume direct upload reservation", "userId", input.User.ID, "fileId", fileID, "error", err)
		return validatedCompleteUpload{}, huma.Error500InternalServerError("Storage quota unavailable")
	}
	return validatedCompleteUpload{userID: userID, fileID: fileID, filename: filename, pathname: pathname, reservation: reservation}, nil
}
