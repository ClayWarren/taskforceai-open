package run

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	adapterartifacts "github.com/TaskForceAI/adapters/pkg/artifacts"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/core/pkg/agent"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
	developerfiles "github.com/TaskForceAI/go-engine/pkg/handlers/developer/files"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"
)

func TestGeneratedFileArtifactType(t *testing.T) {
	tests := []struct {
		name     string
		mimeType string
		filename string
		toolName string
		want     coreartifacts.ArtifactType
	}{
		{
			name:     "chart tool wins for generated image",
			mimeType: "image/png",
			filename: "sunlight.png",
			toolName: "create_chart",
			want:     coreartifacts.ArtifactTypeChart,
		},
		{
			name:     "spreadsheet extension",
			mimeType: "application/octet-stream",
			filename: "budget.xlsx",
			toolName: "execute_code",
			want:     coreartifacts.ArtifactTypeSpreadsheet,
		},
		{
			name:     "video mime",
			mimeType: "video/mp4",
			filename: "clip.mp4",
			toolName: "generate_video",
			want:     coreartifacts.ArtifactTypeVideo,
		},
		{
			name:     "document mime",
			mimeType: "application/pdf",
			filename: "report.pdf",
			toolName: "create_document",
			want:     coreartifacts.ArtifactTypeDocument,
		},
		{
			name:     "site tool wins for html",
			mimeType: "text/html",
			filename: "customer-review.html",
			toolName: "create_site",
			want:     coreartifacts.ArtifactTypeSite,
		},
		{
			name:     "html extension",
			mimeType: "application/octet-stream",
			filename: "index.htm",
			toolName: "execute_code",
			want:     coreartifacts.ArtifactTypeSite,
		},
		{
			name:     "spreadsheet tool",
			mimeType: "application/octet-stream",
			filename: "output.bin",
			toolName: "create_spreadsheet",
			want:     coreartifacts.ArtifactTypeSpreadsheet,
		},
		{
			name:     "image mime",
			mimeType: "image/jpeg",
			filename: "photo.jpg",
			toolName: "create_image",
			want:     coreartifacts.ArtifactTypeImage,
		},
		{
			name:     "archive extension",
			mimeType: "application/octet-stream",
			filename: "outputs.zip",
			toolName: "execute_code",
			want:     coreartifacts.ArtifactTypeArchive,
		},
		{
			name:     "document extension",
			mimeType: "application/octet-stream",
			filename: "notes.md",
			toolName: "execute_code",
			want:     coreartifacts.ArtifactTypeDocument,
		},
		{
			name:     "other fallback",
			mimeType: "application/octet-stream",
			filename: "artifact.bin",
			toolName: "execute_code",
			want:     coreartifacts.ArtifactTypeOther,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := generatedFileArtifactType(tt.mimeType, tt.filename, tt.toolName)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestGeneratedFileArtifactHelpers(t *testing.T) {
	require.Equal(t, "Generated artifact", generatedFileArtifactTitle("   "))
	require.Nil(t, stringPtrOrNil("   "))
	require.Equal(t, "value", *stringPtrOrNil(" value "))

	require.False(t, isFirstPartyGeneratedFileTool(" read_file "))
	require.True(t, isFirstPartyGeneratedFileTool("create_pdf"))

	require.Empty(t, cleanGeneratedFileRelativePath(""))
	require.Empty(t, cleanGeneratedFileRelativePath(" ../secret.txt"))
	require.Empty(t, cleanGeneratedFileRelativePath(filepath.Join("..", "secret.txt")))
	require.Equal(t, "nested/report.csv", cleanGeneratedFileRelativePath("nested/report.csv"))
}

func TestHasUnpersistedGeneratedFileRequiresFirstPartyTool(t *testing.T) {
	events := []agent.ToolEvent{{
		ToolName: "read_file",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  "secrets.txt",
			LocalPath: "/etc/passwd",
		},
	}}

	require.False(t, hasUnpersistedGeneratedFile(events))
}

func TestHasUnpersistedGeneratedFileRejectsToolNameMismatch(t *testing.T) {
	events := []agent.ToolEvent{{
		ToolName: "create_chart",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  "secrets.txt",
			ToolName:  "read_file",
			LocalPath: "/etc/passwd",
		},
	}}

	require.False(t, hasUnpersistedGeneratedFile(events))
}

func TestHasUnpersistedGeneratedFileAllowsFirstPartyTool(t *testing.T) {
	localPath := filepath.Join(t.TempDir(), "chart.png")
	events := []agent.ToolEvent{{
		ToolName: "create_chart",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  "chart.png",
			ToolName:  "create_chart",
			Filepath:  "chart.png",
			LocalPath: localPath,
		},
	}}

	require.True(t, hasUnpersistedGeneratedFile(events))
}

func TestHasUnpersistedGeneratedFileRejectsWhitespaceMutatedPath(t *testing.T) {
	localPath := filepath.Join(t.TempDir(), "report.csv")
	events := []agent.ToolEvent{{
		ToolName: "create_csv",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  "report.csv",
			ToolName:  "create_csv",
			Filepath:  "report.csv ",
			LocalPath: localPath,
		},
	}}

	require.False(t, hasUnpersistedGeneratedFile(events))
}

func TestHasUnpersistedGeneratedFileRejectsAbsoluteMetadataPath(t *testing.T) {
	events := []agent.ToolEvent{{
		ToolName: "create_csv",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  "secrets.csv",
			ToolName:  "create_csv",
			Filepath:  "/etc/passwd",
			LocalPath: filepath.Join(t.TempDir(), "secrets.csv"),
		},
	}}

	require.False(t, hasUnpersistedGeneratedFile(events))
}

func TestValidateGeneratedFileLocalPathRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.csv")
	require.NoError(t, os.WriteFile(outside, []byte("secret"), 0o600))
	linkPath := filepath.Join(dir, "report.csv")
	require.NoError(t, os.Symlink(outside, linkPath))

	err := validateGeneratedFileLocalPath(&agent.GeneratedFile{
		Filename:  "report.csv",
		Filepath:  "report.csv",
		LocalPath: linkPath,
	})

	require.ErrorContains(t, err, "symlink")
}

func TestValidateGeneratedFileLocalPathRejectsMetadataMismatch(t *testing.T) {
	localPath := filepath.Join(t.TempDir(), "report.csv")
	require.NoError(t, os.WriteFile(localPath, []byte("ok"), 0o600))

	err := validateGeneratedFileLocalPath(&agent.GeneratedFile{
		Filename:  "secret.csv",
		Filepath:  "secret.csv",
		LocalPath: localPath,
	})

	require.ErrorContains(t, err, "does not match")
}

func TestValidateGeneratedFileLocalPathBranches(t *testing.T) {
	require.ErrorContains(t, validateGeneratedFileLocalPath(nil), "unsafe")

	dir := t.TempDir()
	filePath := filepath.Join(dir, "report.csv")
	require.NoError(t, os.WriteFile(filePath, []byte("ok"), 0o600))
	require.NoError(t, validateGeneratedFileLocalPath(&agent.GeneratedFile{
		Filename:  "report.csv",
		Filepath:  "nested/report.csv",
		LocalPath: filePath,
	}))

	require.ErrorContains(t, validateGeneratedFileLocalPath(&agent.GeneratedFile{
		Filename:  "report.csv",
		Filepath:  "report.csv",
		LocalPath: filePath + string(os.PathSeparator) + "..",
	}), "unclean")

	require.Error(t, validateGeneratedFileLocalPath(&agent.GeneratedFile{
		Filename:  "missing.csv",
		Filepath:  "missing.csv",
		LocalPath: filepath.Join(dir, "missing.csv"),
	}))

	require.ErrorContains(t, validateGeneratedFileLocalPath(&agent.GeneratedFile{
		Filename:  "dir",
		Filepath:  "dir",
		LocalPath: dir,
	}), "not a regular file")
}

func TestPersistGeneratedFileArtifactsNoopAndLoaderError(t *testing.T) {
	events := []agent.ToolEvent{{ToolName: "read_file"}}
	persisted, err := persistGeneratedFileArtifacts(context.Background(), GeneratedFilePersistenceInput{Events: events})
	require.NoError(t, err)
	require.Equal(t, events, persisted)

	originalGetter := DBQueriesGetter
	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	}
	t.Cleanup(func() { DBQueriesGetter = originalGetter })

	localPath := filepath.Join(t.TempDir(), "chart.png")
	persisted, err = persistGeneratedFileArtifacts(context.Background(), GeneratedFilePersistenceInput{
		Events: []agent.ToolEvent{{
			ToolName: "create_chart",
			GeneratedFile: &agent.GeneratedFile{
				Filename:  "chart.png",
				Filepath:  "chart.png",
				LocalPath: localPath,
			},
		}},
	})
	require.EqualError(t, err, "db down")
	require.Len(t, persisted, 1)
}

func TestPersistGeneratedFileArtifactsFailureBranches(t *testing.T) {
	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)
	originalGetter := DBQueriesGetter
	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return q, nil
	}
	t.Cleanup(func() { DBQueriesGetter = originalGetter })

	dir := t.TempDir()
	validPath := filepath.Join(dir, "site.html")
	require.NoError(t, os.WriteFile(validPath, []byte("<!doctype html>"), 0o600))
	unreadablePath := filepath.Join(dir, "unreadable.html")
	require.NoError(t, os.WriteFile(unreadablePath, []byte("<!doctype html>"), 0o000))

	events := []agent.ToolEvent{
		{
			ToolName: "create_site",
			GeneratedFile: &agent.GeneratedFile{
				Filename:  "invalid.html",
				Filepath:  "other.html",
				LocalPath: validPath,
				MimeType:  "text/html",
				ToolName:  "create_site",
			},
		},
		{
			ToolName: "create_site",
			GeneratedFile: &agent.GeneratedFile{
				Filename:  "unreadable.html",
				Filepath:  "unreadable.html",
				LocalPath: unreadablePath,
				MimeType:  "text/html",
				ToolName:  "create_site",
			},
		},
		{
			ToolName: "create_site",
			GeneratedFile: &agent.GeneratedFile{
				Filename:  "unsupported.bin",
				Filepath:  "site.html",
				LocalPath: validPath,
				MimeType:  "application/octet-stream",
				ToolName:  "create_site",
			},
		},
	}

	persisted, err := persistGeneratedFileArtifacts(context.Background(), GeneratedFilePersistenceInput{
		UserID: 7,
		Events: events,
	})
	require.NoError(t, err)
	require.Len(t, persisted, 3)
	for _, event := range persisted {
		require.Empty(t, event.GeneratedFile.FileID)
	}
	require.NoError(t, dbMock.ExpectationsWereMet())
}

func TestCreateGeneratedFileArtifactErrorBranches(t *testing.T) {
	restore(t, &marshalGeneratedFileMetadata)
	marshalGeneratedFileMetadata = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
	_, err := createGeneratedFileArtifact(context.Background(), generatedFileSQLStore{}, generatedFileArtifactInput{UserID: 7})
	require.ErrorContains(t, err, "encode generated file metadata")
	marshalGeneratedFileMetadata = json.Marshal

	_, err = createGeneratedFileArtifact(context.Background(), generatedFileSQLStore{}, generatedFileArtifactInput{
		UserID: int(^uint32(0)),
	})
	require.Error(t, err)

	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)
	store := generatedFileSQLStore{SQLStore: adapterartifacts.NewSQLStore(q), q: q}
	dbMock.ExpectQuery("INSERT INTO artifacts").
		WithArgs(pgxmock.AnyArg(), (*int32)(nil), int32(7), pgxmock.AnyArg(), pgxmock.AnyArg(), (*string)(nil), db.ArtifactTypeDOCUMENT, "report.pdf", db.ArtifactStatusREADY, db.ArtifactVisibilityPRIVATE, pgxmock.AnyArg()).
		WillReturnError(errors.New("artifact insert failed"))

	_, err = createGeneratedFileArtifact(context.Background(), store, generatedFileArtifactInput{
		UserID:      7,
		FileID:      "file-1",
		Filename:    "report.pdf",
		MimeType:    "application/pdf",
		Bytes:       12,
		DownloadURL: "/api/v1/developer/files/file-1/content",
	})
	require.EqualError(t, err, "artifact insert failed")
	require.NoError(t, dbMock.ExpectationsWereMet())
}

func TestPersistGeneratedFileArtifactsCreatesDeveloperFileAndArtifact(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "report.html")
	require.NoError(t, os.WriteFile(localPath, []byte("<!doctype html><title>Report</title>"), 0o600))

	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)
	originalGetter := DBQueriesGetter
	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return q, nil
	}
	t.Cleanup(func() { DBQueriesGetter = originalGetter })

	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgID := int32(12)
	taskID := "task-123"
	filename := "report.html"
	mimeType := "text/html"
	size := int64(len("<!doctype html><title>Report</title>"))
	fileID := "file-generated"
	artifactID := "artifact-generated"
	versionID := "version-generated"

	dbMock.ExpectExec("INSERT INTO user_storage_quotas").
		WithArgs(int32(7)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	dbMock.ExpectQuery("UPDATE user_storage_quotas").
		WithArgs(int32(7), size).
		WillReturnRows(pgxmock.NewRows([]string{"user_id", "quota_bytes", "used_bytes", "created_at", "updated_at"}).
			AddRow(int32(7), int64(1000), size, now, now))
	dbMock.ExpectQuery("INSERT INTO developer_files").
		WithArgs(pgxmock.AnyArg(), int32(7), &orgID, filename, "assistants", mimeType, size, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "user_id", "organization_id", "filename", "purpose", "mime_type", "bytes", "blob_url", "blob_path", "created_at", "updated_at", "deleted_at",
		}).AddRow(fileID, int32(7), &orgID, filename, "assistants", mimeType, size, "local-generated://"+fileID, fileID, now, now, pgtype.Timestamp{}))
	dbMock.ExpectQuery("INSERT INTO artifacts").
		WithArgs(pgxmock.AnyArg(), &orgID, int32(7), pgxmock.AnyArg(), pgxmock.AnyArg(), &taskID, db.ArtifactTypeSITE, filename, db.ArtifactStatusREADY, db.ArtifactVisibilityPRIVATE, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "organization_id", "owner_user_id", "conversation_id", "message_id", "task_id", "type", "title", "status", "visibility", "current_version_id", "metadata", "created_at", "updated_at", "deleted_at",
		}).AddRow(artifactID, &orgID, int32(7), (*int32)(nil), (*string)(nil), &taskID, db.ArtifactTypeSITE, filename, db.ArtifactStatusREADY, db.ArtifactVisibilityPRIVATE, (*string)(nil), []byte(`{}`), now, now, pgtype.Timestamp{}))
	dbMock.ExpectQuery("INSERT INTO artifact_versions").
		WithArgs(pgxmock.AnyArg(), artifactID, int32(1), &fileID, &mimeType, &filename, &size, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "artifact_id", "version", "file_id", "mime_type", "filename", "bytes", "render_metadata", "source_tool_name", "source_prompt", "created_by_user_id", "created_at",
		}).AddRow(versionID, artifactID, int32(1), &fileID, &mimeType, &filename, &size, []byte(nil), stringPtr("create_site"), (*string)(nil), int32Ptr(7), now))
	dbMock.ExpectQuery("UPDATE artifacts").
		WithArgs(&versionID, artifactID, int32(7), &orgID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "organization_id", "owner_user_id", "conversation_id", "message_id", "task_id", "type", "title", "status", "visibility", "current_version_id", "metadata", "created_at", "updated_at", "deleted_at",
		}).AddRow(artifactID, &orgID, int32(7), (*int32)(nil), (*string)(nil), &taskID, db.ArtifactTypeSITE, filename, db.ArtifactStatusREADY, db.ArtifactVisibilityPRIVATE, &versionID, []byte(`{}`), now, now, pgtype.Timestamp{}))

	events := []agent.ToolEvent{{
		ToolName: "create_site",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  filename,
			Filepath:  filename,
			MimeType:  mimeType,
			LocalPath: localPath,
			ToolName:  "create_site",
		},
	}}

	persisted, err := persistGeneratedFileArtifacts(context.Background(), GeneratedFilePersistenceInput{
		UserID: 7,
		OrgID:  &orgID,
		TaskID: taskID,
		Events: events,
	})

	require.NoError(t, err)
	require.Len(t, persisted, 1)
	require.NotNil(t, persisted[0].GeneratedFile)
	require.Equal(t, fileID, persisted[0].GeneratedFile.FileID)
	require.Equal(t, artifactID, persisted[0].GeneratedFile.ArtifactID)
	require.Equal(t, "/api/v1/developer/files/file-generated/content", persisted[0].GeneratedFile.DownloadURL)
	require.Equal(t, size, persisted[0].GeneratedFile.Bytes)
	require.NoError(t, dbMock.ExpectationsWereMet())
}

func TestPersistGeneratedFileArtifactsArtifactRecordFailure(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "chart.png")
	require.NoError(t, os.WriteFile(localPath, []byte("png"), 0o600))

	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)
	originalGetter := DBQueriesGetter
	DBQueriesGetter = func(context.Context) (*db.Queries, error) {
		return q, nil
	}
	t.Cleanup(func() { DBQueriesGetter = originalGetter })

	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	filename := "chart.png"
	mimeType := "image/png"
	size := int64(3)
	fileID := "file-artifact-fail"
	taskID := "task-artifact-fail"

	dbMock.ExpectExec("INSERT INTO user_storage_quotas").
		WithArgs(int32(7)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	dbMock.ExpectQuery("UPDATE user_storage_quotas").
		WithArgs(int32(7), size).
		WillReturnRows(pgxmock.NewRows([]string{"user_id", "quota_bytes", "used_bytes", "created_at", "updated_at"}).
			AddRow(int32(7), int64(1000), size, now, now))
	dbMock.ExpectQuery("INSERT INTO developer_files").
		WithArgs(pgxmock.AnyArg(), int32(7), (*int32)(nil), filename, "assistants", mimeType, size, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "user_id", "organization_id", "filename", "purpose", "mime_type", "bytes", "blob_url", "blob_path", "created_at", "updated_at", "deleted_at",
		}).AddRow(fileID, int32(7), (*int32)(nil), filename, "assistants", mimeType, size, "local-generated://"+fileID, fileID, now, now, pgtype.Timestamp{}))
	dbMock.ExpectQuery("INSERT INTO artifacts").
		WithArgs(pgxmock.AnyArg(), (*int32)(nil), int32(7), pgxmock.AnyArg(), pgxmock.AnyArg(), &taskID, db.ArtifactTypeCHART, filename, db.ArtifactStatusREADY, db.ArtifactVisibilityPRIVATE, pgxmock.AnyArg()).
		WillReturnError(errors.New("artifact insert failed"))

	persisted, err := persistGeneratedFileArtifacts(context.Background(), GeneratedFilePersistenceInput{
		UserID: 7,
		TaskID: taskID,
		Events: []agent.ToolEvent{
			{
				ToolName: "create_chart",
				GeneratedFile: &agent.GeneratedFile{
					Filename:  filename,
					Filepath:  filename,
					MimeType:  mimeType,
					LocalPath: localPath,
					ToolName:  "create_chart",
				},
			},
			{ToolName: "read_file"},
		},
	})

	require.NoError(t, err)
	require.Len(t, persisted, 2)
	require.Equal(t, fileID, persisted[0].GeneratedFile.FileID)
	require.Empty(t, persisted[0].GeneratedFile.ArtifactID)
	require.NoError(t, dbMock.ExpectationsWereMet())
}

func TestGeneratedFileSQLStoreStorageAndReservationAdapters(t *testing.T) {
	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	dbMock := dbtest.NewMockPoolRegexp(t)
	store := generatedFileSQLStore{q: db.New(dbMock)}
	ctx := context.Background()
	expiresAt := pgtype.Timestamp{Time: time.Now().Add(time.Hour), Valid: true}

	dbMock.ExpectQuery("GetUserStorageQuota").
		WithArgs(int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{"user_id", "quota_bytes", "used_bytes", "created_at", "updated_at"}).
			AddRow(int32(7), int64(1000), int64(120), now, now))
	quota, err := store.GetUserStorageQuota(ctx, 7)
	require.NoError(t, err)
	require.Equal(t, int64(120), quota.UsedBytes)

	dbMock.ExpectQuery("GetUserStorageQuota").
		WithArgs(int32(8)).
		WillReturnError(errors.New("quota missing"))
	_, err = store.GetUserStorageQuota(ctx, 8)
	require.EqualError(t, err, "quota missing")

	dbMock.ExpectQuery("ReleaseUserStorageBytes").
		WithArgs(int32(7), int64(30)).
		WillReturnRows(pgxmock.NewRows([]string{"user_id", "quota_bytes", "used_bytes", "created_at", "updated_at"}).
			AddRow(int32(7), int64(1000), int64(90), now, now))
	require.NoError(t, store.ReleaseUserStorageBytes(ctx, developerfiles.StorageQuotaUpdateInput{UserID: 7, UsedBytes: 30}))

	dbMock.ExpectQuery("INSERT INTO developer_file_upload_reservations").
		WithArgs("file-1", int32(7), "blob/file-1", int64(44), expiresAt).
		WillReturnRows(uploadReservationRows().AddRow("file-1", int32(7), "blob/file-1", int64(44), expiresAt, pgtype.Timestamp{}, now, now))
	created, err := store.CreateDeveloperFileUploadReservation(ctx, developerfiles.CreateDeveloperFileUploadReservationInput{
		FileID:        "file-1",
		UserID:        7,
		BlobPath:      "blob/file-1",
		ReservedBytes: 44,
		ExpiresAt:     expiresAt,
	})
	require.NoError(t, err)
	require.Equal(t, int64(44), created.ReservedBytes)

	dbMock.ExpectQuery("INSERT INTO developer_file_upload_reservations").
		WithArgs("file-err", int32(7), "blob/file-err", int64(44), expiresAt).
		WillReturnError(errors.New("reservation failed"))
	_, err = store.CreateDeveloperFileUploadReservation(ctx, developerfiles.CreateDeveloperFileUploadReservationInput{
		FileID:        "file-err",
		UserID:        7,
		BlobPath:      "blob/file-err",
		ReservedBytes: 44,
		ExpiresAt:     expiresAt,
	})
	require.EqualError(t, err, "reservation failed")

	dbMock.ExpectQuery("UPDATE developer_file_upload_reservations").
		WithArgs("file-1", int32(7), "blob/file-1").
		WillReturnRows(uploadReservationRows().AddRow("file-1", int32(7), "blob/file-1", int64(44), expiresAt, now, now, now))
	consumed, err := store.ConsumeDeveloperFileUploadReservation(ctx, developerfiles.DeveloperFileUploadReservationLookupInput{
		FileID:   "file-1",
		UserID:   7,
		BlobPath: "blob/file-1",
	})
	require.NoError(t, err)
	require.True(t, consumed.CompletedAt.Valid)

	dbMock.ExpectQuery("UPDATE developer_file_upload_reservations").
		WithArgs("file-err", int32(7), "blob/file-err").
		WillReturnError(errors.New("consume failed"))
	_, err = store.ConsumeDeveloperFileUploadReservation(ctx, developerfiles.DeveloperFileUploadReservationLookupInput{
		FileID:   "file-err",
		UserID:   7,
		BlobPath: "blob/file-err",
	})
	require.EqualError(t, err, "consume failed")

	dbMock.ExpectQuery("DELETE FROM developer_file_upload_reservations").
		WithArgs(int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{"reserved_bytes"}).AddRow(int64(10)).AddRow(int64(20)))
	released, err := store.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, 7)
	require.NoError(t, err)
	require.Equal(t, []int64{10, 20}, released)

	require.NoError(t, dbMock.ExpectationsWereMet())
}

func TestGeneratedFileSQLStoreDeveloperFileAdapters(t *testing.T) {
	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgID := int32(12)
	dbMock := dbtest.NewMockPoolRegexp(t)
	store := generatedFileSQLStore{q: db.New(dbMock)}
	ctx := context.Background()

	dbMock.ExpectQuery("INSERT INTO developer_files").
		WithArgs("file-1", int32(7), &orgID, "report.pdf", "assistants", "application/pdf", int64(100), "blob://file-1", "blob/file-1").
		WillReturnRows(developerFileRows().AddRow("file-1", int32(7), &orgID, "report.pdf", "assistants", "application/pdf", int64(100), "blob://file-1", "blob/file-1", now, now, pgtype.Timestamp{}))
	created, err := store.CreateDeveloperFile(ctx, developerfiles.CreateDeveloperFileInput{
		ID:             "file-1",
		UserID:         7,
		OrganizationID: &orgID,
		Filename:       "report.pdf",
		Purpose:        "assistants",
		MimeType:       "application/pdf",
		Bytes:          100,
		BlobURL:        "blob://file-1",
		BlobPath:       "blob/file-1",
	})
	require.NoError(t, err)
	require.Equal(t, "file-1", created.ID)

	dbMock.ExpectQuery("INSERT INTO developer_files").
		WithArgs("file-err", int32(7), &orgID, "report.pdf", "assistants", "application/pdf", int64(100), "blob://file-err", "blob/file-err").
		WillReturnError(errors.New("create failed"))
	_, err = store.CreateDeveloperFile(ctx, developerfiles.CreateDeveloperFileInput{
		ID:             "file-err",
		UserID:         7,
		OrganizationID: &orgID,
		Filename:       "report.pdf",
		Purpose:        "assistants",
		MimeType:       "application/pdf",
		Bytes:          100,
		BlobURL:        "blob://file-err",
		BlobPath:       "blob/file-err",
	})
	require.EqualError(t, err, "create failed")

	dbMock.ExpectQuery("GetDeveloperFileByIDForUser").
		WithArgs("file-1", int32(7)).
		WillReturnRows(developerFileRows().AddRow("file-1", int32(7), &orgID, "report.pdf", "assistants", "application/pdf", int64(100), "blob://file-1", "blob/file-1", now, now, pgtype.Timestamp{}))
	found, err := store.GetDeveloperFileByIDForUser(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 7})
	require.NoError(t, err)
	require.Equal(t, "report.pdf", found.Filename)

	dbMock.ExpectQuery("GetDeveloperFileByIDForUser").
		WithArgs("missing", int32(7)).
		WillReturnError(errors.New("not found"))
	_, err = store.GetDeveloperFileByIDForUser(ctx, developerfiles.DeveloperFileLookupInput{ID: "missing", UserID: 7})
	require.EqualError(t, err, "not found")

	dbMock.ExpectQuery("ListDeveloperFilesByUser").
		WithArgs(int32(7), int32(25), int32(0)).
		WillReturnRows(developerFileRows().AddRow("file-1", int32(7), &orgID, "report.pdf", "assistants", "application/pdf", int64(100), "blob://file-1", "blob/file-1", now, now, pgtype.Timestamp{}))
	listed, err := store.ListDeveloperFilesByUser(ctx, developerfiles.ListDeveloperFilesInput{UserID: 7, Limit: 25, Offset: 0})
	require.NoError(t, err)
	require.Len(t, listed, 1)

	dbMock.ExpectQuery("ListDeveloperFilesByUser").
		WithArgs(int32(7), int32(25), int32(25)).
		WillReturnError(errors.New("list failed"))
	_, err = store.ListDeveloperFilesByUser(ctx, developerfiles.ListDeveloperFilesInput{UserID: 7, Limit: 25, Offset: 25})
	require.EqualError(t, err, "list failed")

	dbMock.ExpectQuery("CountDeveloperFilesByUser").
		WithArgs(int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(3)))
	count, err := store.CountDeveloperFilesByUser(ctx, 7)
	require.NoError(t, err)
	require.Equal(t, int64(3), count)

	dbMock.ExpectQuery("WITH categorized_files").
		WithArgs(int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{"category", "bytes", "count"}).AddRow("images", int64(100), int64(2)))
	stats, err := store.GetDeveloperFileStorageStatsByUser(ctx, 7)
	require.NoError(t, err)
	require.Equal(t, "images", stats[0].Category)

	dbMock.ExpectQuery("WITH categorized_files").
		WithArgs(int32(8)).
		WillReturnError(errors.New("stats failed"))
	_, err = store.GetDeveloperFileStorageStatsByUser(ctx, 8)
	require.EqualError(t, err, "stats failed")

	dbMock.ExpectQuery("MarkDeveloperFileDeleted").
		WithArgs("file-1", int32(7)).
		WillReturnRows(developerFileRows().AddRow("file-1", int32(7), &orgID, "report.pdf", "assistants", "application/pdf", int64(100), "blob://file-1", "blob/file-1", now, now, now))
	deleted, err := store.MarkDeveloperFileDeleted(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 7})
	require.NoError(t, err)
	require.Equal(t, "file-1", deleted.ID)

	dbMock.ExpectQuery("MarkDeveloperFileDeleted").
		WithArgs("file-err", int32(7)).
		WillReturnError(errors.New("delete failed"))
	_, err = store.MarkDeveloperFileDeleted(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-err", UserID: 7})
	require.EqualError(t, err, "delete failed")

	dbMock.ExpectExec("RestoreDeveloperFileDeletion").
		WithArgs("file-1", int32(7)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, store.RestoreDeveloperFileDeletion(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 7}))

	require.NoError(t, dbMock.ExpectationsWereMet())
}

func developerFileRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "user_id", "organization_id", "filename", "purpose", "mime_type", "bytes", "blob_url", "blob_path", "created_at", "updated_at", "deleted_at",
	})
}

func uploadReservationRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"file_id", "user_id", "blob_path", "reserved_bytes", "expires_at", "completed_at", "created_at", "updated_at",
	})
}

func stringPtr(value string) *string {
	return &value
}

func int32Ptr(value int32) *int32 {
	return &value
}
