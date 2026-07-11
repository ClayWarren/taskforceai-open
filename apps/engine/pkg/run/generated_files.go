package run

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	adapterartifacts "github.com/TaskForceAI/adapters/pkg/artifacts"
	"github.com/TaskForceAI/adapters/pkg/convert"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/core/pkg/agent"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
	developerfiles "github.com/TaskForceAI/go-engine/pkg/handlers/developer/files"
)

type GeneratedFilePersistenceInput struct {
	UserID int
	OrgID  *int32
	TaskID string
	Events []agent.ToolEvent
}

func persistGeneratedFileArtifacts(ctx context.Context, input GeneratedFilePersistenceInput) ([]agent.ToolEvent, error) {
	if !hasUnpersistedGeneratedFile(input.Events) {
		return input.Events, nil
	}
	q, err := DBQueriesGetter(ctx)
	if err != nil {
		return input.Events, err
	}
	store := generatedFileSQLStore{
		SQLStore: adapterartifacts.NewSQLStore(q),
		q:        q,
	}
	events := make([]agent.ToolEvent, len(input.Events))
	copy(events, input.Events)
	for i := range events {
		file := events[i].GeneratedFile
		if !shouldPersistGeneratedFile(events[i]) {
			continue
		}
		toolName := strings.TrimSpace(events[i].ToolName)
		mimeType := strings.TrimSpace(file.MimeType)
		artifactType := string(generatedFileArtifactType(mimeType, file.Filename, toolName))
		fileCtx, fileSpan := startGeneratedFileSpan(ctx, toolName, mimeType, artifactType)
		startedAt := time.Now()
		if err := validateGeneratedFileLocalPath(file); err != nil {
			slog.Warn("Refusing unsafe generated file artifact path", "path", file.LocalPath, "error", err)
			finishGeneratedFileObservation(fileCtx, fileSpan, startedAt, toolName, mimeType, artifactType, 0, "invalid_local_path", err)
			continue
		}
		content, err := os.ReadFile(file.LocalPath) // #nosec G304 -- validateGeneratedFileLocalPath rejects whitespace-mutated, symlink, and non-regular generated artifact paths before reading.
		if err != nil {
			slog.Warn("Failed to read generated file artifact", "path", file.LocalPath, "error", err)
			finishGeneratedFileObservation(fileCtx, fileSpan, startedAt, toolName, mimeType, artifactType, 0, "read_failed", err)
			continue
		}
		bytes := int64(len(content))
		record, err := developerfiles.CreateGeneratedFile(fileCtx, store, developerfiles.CreateGeneratedFileInput{
			UserID:         input.UserID,
			OrganizationID: input.OrgID,
			Filename:       file.Filename,
			Purpose:        "assistants",
			MimeType:       file.MimeType,
			Content:        content,
		})
		if err != nil {
			slog.Warn("Failed to persist generated file artifact", "filename", file.Filename, "error", err)
			finishGeneratedFileObservation(fileCtx, fileSpan, startedAt, toolName, mimeType, artifactType, bytes, "file_persist_failed", err)
			continue
		}
		mimeType = record.MimeType
		artifactType = string(generatedFileArtifactType(record.MimeType, record.Filename, toolName))
		file.FileID = record.ID
		file.Filename = record.Filename
		file.MimeType = record.MimeType
		file.Bytes = record.Bytes
		file.DownloadURL = fmt.Sprintf("/api/v1/developer/files/%s/content", url.PathEscape(record.ID))
		artifactID, err := createGeneratedFileArtifact(fileCtx, store, generatedFileArtifactInput{
			UserID:      input.UserID,
			OrgID:       input.OrgID,
			TaskID:      input.TaskID,
			ToolName:    events[i].ToolName,
			FileID:      record.ID,
			Filename:    record.Filename,
			MimeType:    record.MimeType,
			Bytes:       record.Bytes,
			DownloadURL: file.DownloadURL,
		})
		if err != nil {
			slog.Warn("Failed to create generated file artifact record", "filename", record.Filename, "fileId", record.ID, "error", err)
			finishGeneratedFileObservation(fileCtx, fileSpan, startedAt, toolName, mimeType, artifactType, record.Bytes, "artifact_record_failed", err)
		} else {
			file.ArtifactID = artifactID
			finishGeneratedFileObservation(fileCtx, fileSpan, startedAt, toolName, mimeType, artifactType, record.Bytes, "persisted", nil)
		}
		events[i].GeneratedFile = file
	}
	return events, nil
}

type generatedFileArtifactInput struct {
	UserID      int
	OrgID       *int32
	TaskID      string
	ToolName    string
	FileID      string
	Filename    string
	MimeType    string
	Bytes       int64
	DownloadURL string
}

var marshalGeneratedFileMetadata = json.Marshal

func createGeneratedFileArtifact(ctx context.Context, store generatedFileSQLStore, input generatedFileArtifactInput) (string, error) {
	userID, err := convert.Int32(input.UserID, "user_id")
	if err != nil {
		return "", err
	}
	fileID := input.FileID
	bytes := input.Bytes
	metadata, err := marshalGeneratedFileMetadata(map[string]any{
		"downloadUrl": input.DownloadURL,
		"fileId":      input.FileID,
	})
	if err != nil {
		return "", fmt.Errorf("encode generated file metadata: %w", err)
	}
	artifact, err := coreartifacts.NewService(store).CreateArtifactWithInitialVersion(ctx, coreartifacts.CreateArtifactInput{
		OrganizationID:  input.OrgID,
		OwnerUserID:     userID,
		TaskID:          stringPtrOrNil(input.TaskID),
		Type:            generatedFileArtifactType(input.MimeType, input.Filename, input.ToolName),
		Title:           generatedFileArtifactTitle(input.Filename),
		Visibility:      coreartifacts.ArtifactVisibilityPrivate,
		Metadata:        metadata,
		FileID:          &fileID,
		MimeType:        stringPtrOrNil(input.MimeType),
		Filename:        stringPtrOrNil(input.Filename),
		Bytes:           &bytes,
		SourceToolName:  stringPtrOrNil(input.ToolName),
		CreatedByUserID: &userID,
	})
	if err != nil {
		return "", err
	}
	return artifact.Artifact.ID, nil
}

func generatedFileArtifactTitle(filename string) string {
	if trimmed := strings.TrimSpace(filename); trimmed != "" {
		return trimmed
	}
	return "Generated artifact"
}

func generatedFileArtifactType(mimeType, filename, toolName string) coreartifacts.ArtifactType {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	extension := strings.ToLower(filepath.Ext(filename))
	toolName = strings.ToLower(strings.TrimSpace(toolName))
	switch {
	case strings.Contains(toolName, "chart"):
		return coreartifacts.ArtifactTypeChart
	case strings.Contains(toolName, "site"), mimeType == "text/html", mimeType == "application/xhtml+xml", extension == ".html", extension == ".htm":
		return coreartifacts.ArtifactTypeSite
	case strings.Contains(toolName, "spreadsheet"), extension == ".xlsx", extension == ".xls", extension == ".csv":
		return coreartifacts.ArtifactTypeSpreadsheet
	case strings.HasPrefix(mimeType, "image/"):
		return coreartifacts.ArtifactTypeImage
	case strings.HasPrefix(mimeType, "video/"):
		return coreartifacts.ArtifactTypeVideo
	case strings.Contains(mimeType, "pdf"), strings.HasPrefix(mimeType, "text/"), extension == ".docx", extension == ".md":
		return coreartifacts.ArtifactTypeDocument
	case extension == ".zip", extension == ".tar", extension == ".gz":
		return coreartifacts.ArtifactTypeArchive
	default:
		return coreartifacts.ArtifactTypeOther
	}
}

func stringPtrOrNil(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func hasUnpersistedGeneratedFile(events []agent.ToolEvent) bool {
	for _, event := range events {
		if shouldPersistGeneratedFile(event) {
			return true
		}
	}
	return false
}

func shouldPersistGeneratedFile(event agent.ToolEvent) bool {
	file := event.GeneratedFile
	if file == nil || file.FileID != "" || !hasCleanGeneratedFileReference(file) {
		return false
	}
	return isFirstPartyGeneratedFileTool(event.ToolName) && (file.ToolName == "" || file.ToolName == event.ToolName)
}

func hasCleanGeneratedFileReference(file *agent.GeneratedFile) bool {
	if file == nil || file.LocalPath == "" || file.LocalPath != strings.TrimSpace(file.LocalPath) || !filepath.IsAbs(file.LocalPath) {
		return false
	}
	if file.Filepath != "" && cleanGeneratedFileRelativePath(file.Filepath) == "" {
		return false
	}
	return true
}

func cleanGeneratedFileRelativePath(value string) string {
	if value == "" || value != strings.TrimSpace(value) || filepath.IsAbs(value) {
		return ""
	}
	clean := filepath.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return ""
	}
	return clean
}

func validateGeneratedFileLocalPath(file *agent.GeneratedFile) error {
	if !hasCleanGeneratedFileReference(file) {
		return fmt.Errorf("unsafe generated file reference")
	}
	cleanLocalPath := filepath.Clean(file.LocalPath)
	if cleanLocalPath != file.LocalPath {
		return fmt.Errorf("unclean generated file local path")
	}
	info, err := os.Lstat(file.LocalPath)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("generated file local path is a symlink")
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("generated file local path is not a regular file")
	}
	if file.Filepath != "" && filepath.Base(cleanGeneratedFileRelativePath(file.Filepath)) != filepath.Base(file.LocalPath) {
		return fmt.Errorf("generated file metadata path does not match local path")
	}
	return nil
}

func isFirstPartyGeneratedFileTool(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "create_spreadsheet", "create_document", "create_presentation", "create_archive", "create_csv", "create_pdf", "create_chart", "create_site":
		return true
	default:
		return false
	}
}

type generatedFileSQLStore struct {
	*adapterartifacts.SQLStore
	q *db.Queries
}

func (s generatedFileSQLStore) EnsureUserStorageQuota(ctx context.Context, userID int32) error {
	return s.q.EnsureUserStorageQuota(ctx, userID)
}

func (s generatedFileSQLStore) GetUserStorageQuota(ctx context.Context, userID int32) (developerfiles.StorageQuotaRecord, error) {
	quota, err := s.q.GetUserStorageQuota(ctx, userID)
	if err != nil {
		return developerfiles.StorageQuotaRecord{}, err
	}
	return developerfiles.StorageQuotaRecord{
		UserID:     quota.UserID,
		QuotaBytes: quota.QuotaBytes,
		UsedBytes:  quota.UsedBytes,
	}, nil
}

func (s generatedFileSQLStore) ReserveUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	_, err := s.q.ReserveUserStorageBytes(ctx, db.ReserveUserStorageBytesParams{
		UserID:    arg.UserID,
		UsedBytes: arg.UsedBytes,
	})
	return err
}

func (s generatedFileSQLStore) ReleaseUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	_, err := s.q.ReleaseUserStorageBytes(ctx, db.ReleaseUserStorageBytesParams{
		UserID:    arg.UserID,
		UsedBytes: arg.UsedBytes,
	})
	return err
}

func (s generatedFileSQLStore) CreateDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.CreateDeveloperFileUploadReservationInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	reservation, err := s.q.CreateDeveloperFileUploadReservation(ctx, db.CreateDeveloperFileUploadReservationParams{
		FileID:        arg.FileID,
		UserID:        arg.UserID,
		BlobPath:      arg.BlobPath,
		ReservedBytes: arg.ReservedBytes,
		ExpiresAt:     arg.ExpiresAt,
	})
	if err != nil {
		return developerfiles.DeveloperFileUploadReservationRecord{}, err
	}
	return mapGeneratedDeveloperFileUploadReservation(reservation), nil
}

func (s generatedFileSQLStore) ConsumeDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.DeveloperFileUploadReservationLookupInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	reservation, err := s.q.ConsumeDeveloperFileUploadReservation(ctx, db.ConsumeDeveloperFileUploadReservationParams{
		FileID:   arg.FileID,
		UserID:   arg.UserID,
		BlobPath: arg.BlobPath,
	})
	if err != nil {
		return developerfiles.DeveloperFileUploadReservationRecord{}, err
	}
	return mapGeneratedDeveloperFileUploadReservation(reservation), nil
}

func (s generatedFileSQLStore) ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error) {
	return s.q.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, userID)
}

func (s generatedFileSQLStore) CreateDeveloperFile(ctx context.Context, arg developerfiles.CreateDeveloperFileInput) (developerfiles.DeveloperFileRecord, error) {
	file, err := s.q.CreateDeveloperFile(ctx, db.CreateDeveloperFileParams{
		ID:             arg.ID,
		UserID:         arg.UserID,
		OrganizationID: arg.OrganizationID,
		Filename:       arg.Filename,
		Purpose:        arg.Purpose,
		MimeType:       arg.MimeType,
		Bytes:          arg.Bytes,
		BlobUrl:        arg.BlobURL,
		BlobPath:       arg.BlobPath,
	})
	if err != nil {
		return developerfiles.DeveloperFileRecord{}, err
	}
	return mapGeneratedDeveloperFile(file), nil
}

func (s generatedFileSQLStore) GetDeveloperFileByIDForUser(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	file, err := s.q.GetDeveloperFileByIDForUser(ctx, db.GetDeveloperFileByIDForUserParams{
		ID:     arg.ID,
		UserID: arg.UserID,
	})
	if err != nil {
		return developerfiles.DeveloperFileRecord{}, err
	}
	return mapGeneratedDeveloperFile(file), nil
}

func (s generatedFileSQLStore) ListDeveloperFilesByUser(ctx context.Context, arg developerfiles.ListDeveloperFilesInput) ([]developerfiles.DeveloperFileRecord, error) {
	files, err := s.q.ListDeveloperFilesByUser(ctx, db.ListDeveloperFilesByUserParams{
		UserID: arg.UserID,
		Limit:  arg.Limit,
		Offset: arg.Offset,
	})
	if err != nil {
		return nil, err
	}
	records := make([]developerfiles.DeveloperFileRecord, len(files))
	for i, file := range files {
		records[i] = mapGeneratedDeveloperFile(file)
	}
	return records, nil
}

func (s generatedFileSQLStore) CountDeveloperFilesByUser(ctx context.Context, userID int32) (int64, error) {
	return s.q.CountDeveloperFilesByUser(ctx, userID)
}

func (s generatedFileSQLStore) GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]developerfiles.DeveloperFileStorageStatsRecord, error) {
	stats, err := s.q.GetDeveloperFileStorageStatsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	records := make([]developerfiles.DeveloperFileStorageStatsRecord, len(stats))
	for i, stat := range stats {
		records[i] = developerfiles.DeveloperFileStorageStatsRecord{
			Category: stat.Category,
			Bytes:    stat.Bytes,
			Count:    stat.Count,
		}
	}
	return records, nil
}

func (s generatedFileSQLStore) MarkDeveloperFileDeleted(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	file, err := s.q.MarkDeveloperFileDeleted(ctx, db.MarkDeveloperFileDeletedParams{
		ID:     arg.ID,
		UserID: arg.UserID,
	})
	if err != nil {
		return developerfiles.DeveloperFileRecord{}, err
	}
	return mapGeneratedDeveloperFile(file), nil
}

func (s generatedFileSQLStore) RestoreDeveloperFileDeletion(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) error {
	return s.q.RestoreDeveloperFileDeletion(ctx, db.RestoreDeveloperFileDeletionParams{
		ID:     arg.ID,
		UserID: arg.UserID,
	})
}

func mapGeneratedDeveloperFile(file db.DeveloperFile) developerfiles.DeveloperFileRecord {
	return developerfiles.DeveloperFileRecord{
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

func mapGeneratedDeveloperFileUploadReservation(reservation db.DeveloperFileUploadReservation) developerfiles.DeveloperFileUploadReservationRecord {
	return developerfiles.DeveloperFileUploadReservationRecord{
		FileID:        reservation.FileID,
		UserID:        reservation.UserID,
		BlobPath:      reservation.BlobPath,
		ReservedBytes: reservation.ReservedBytes,
		ExpiresAt:     reservation.ExpiresAt,
		CompletedAt:   reservation.CompletedAt,
		CreatedAt:     reservation.CreatedAt,
		UpdatedAt:     reservation.UpdatedAt,
	}
}
