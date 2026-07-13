package artifacts

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeArtifactStoreDB struct {
	t             *testing.T
	wantArgs      []any
	row           []any
	err           error
	queryWantArgs []any
	queryRows     [][]any
	queryErr      error
	queryRowsErr  error
	queryScanErr  error
	execWantArgs  []any
	execErr       error
}

func (f fakeArtifactStoreDB) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	if f.execWantArgs == nil {
		f.t.Fatal("Exec should not be called")
		return pgconn.CommandTag{}, nil
	}
	require.Equal(f.t, f.execWantArgs, args)
	return pgconn.NewCommandTag("UPDATE 1"), f.execErr
}

func (f fakeArtifactStoreDB) Query(_ context.Context, _ string, args ...any) (pgx.Rows, error) {
	if f.queryWantArgs == nil {
		f.t.Fatal("Query should not be called")
		return nil, nil
	}
	require.Equal(f.t, f.queryWantArgs, args)
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	return &fakeArtifactStoreRows{rows: f.queryRows, err: f.queryRowsErr, scanErr: f.queryScanErr}, nil
}

func (f fakeArtifactStoreDB) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	require.Equal(f.t, f.wantArgs, args)
	return fakeArtifactStoreRow{values: f.row, err: f.err}
}

type fakeArtifactStoreRow struct {
	values []any
	err    error
}

func (r fakeArtifactStoreRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i, value := range r.values {
		target := reflect.ValueOf(dest[i]).Elem()
		if value == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		target.Set(reflect.ValueOf(value))
	}
	return nil
}

type fakeArtifactStoreRows struct {
	rows    [][]any
	index   int
	closed  bool
	err     error
	scanErr error
}

func (r *fakeArtifactStoreRows) Close() {
	r.closed = true
}

func (r *fakeArtifactStoreRows) Err() error {
	return r.err
}

func (r *fakeArtifactStoreRows) CommandTag() pgconn.CommandTag {
	return pgconn.NewCommandTag("SELECT 1")
}

func (r *fakeArtifactStoreRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}

func (r *fakeArtifactStoreRows) Next() bool {
	return r.index < len(r.rows)
}

func (r *fakeArtifactStoreRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		r.index++
		return r.scanErr
	}
	if r.index >= len(r.rows) {
		return pgx.ErrNoRows
	}
	row := fakeArtifactStoreRow{values: r.rows[r.index]}
	r.index++
	return row.Scan(dest...)
}

func (r *fakeArtifactStoreRows) Values() ([]any, error) {
	if r.index == 0 || r.index > len(r.rows) {
		return nil, pgx.ErrNoRows
	}
	return r.rows[r.index-1], nil
}

func (r *fakeArtifactStoreRows) RawValues() [][]byte {
	return nil
}

func (r *fakeArtifactStoreRows) Conn() *pgx.Conn {
	return nil
}

func artifactDBRow(id string, orgID *int32, visibility db.ArtifactVisibility) []any {
	now := pgtype.Timestamp{Time: time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC), Valid: true}
	return []any{
		id,
		orgID,
		int32(7),
		nil,
		nil,
		nil,
		db.ArtifactTypeDOCUMENT,
		"Report",
		db.ArtifactStatusREADY,
		visibility,
		nil,
		[]byte(`{"kind":"document"}`),
		now,
		now,
		pgtype.Timestamp{},
	}
}

func artifactVersionDBRow(id string, version int32) []any {
	fileID := "file-" + id
	mimeType := "text/html"
	filename := id + ".html"
	bytes := int64(128)
	userID := int32(7)
	now := pgtype.Timestamp{Time: time.Date(2026, 6, 18, 13, 0, 0, 0, time.UTC), Valid: true}
	return []any{
		id,
		"artifact-1",
		version,
		&fileID,
		&mimeType,
		&filename,
		&bytes,
		[]byte(`{"render":"browser"}`),
		nil,
		nil,
		&userID,
		now,
	}
}

func artifactShareDBRow(id string, artifactID string, orgID *int32, tokenHash *string) []any {
	now := pgtype.Timestamp{Time: time.Date(2026, 6, 18, 14, 0, 0, 0, time.UTC), Valid: true}
	return []any{
		id,
		artifactID,
		orgID,
		db.ArtifactShareScopePUBLICLINK,
		nil,
		tokenHash,
		db.ArtifactPermissionVIEW,
		pgtype.Timestamp{},
		now,
		pgtype.Timestamp{},
	}
}

func TestSQLStoreGetArtifactMapsNoRows(t *testing.T) {
	orgID := int32(12)
	store := NewSQLStore(db.New(fakeArtifactStoreDB{
		t:        t,
		wantArgs: []any{"artifact-missing", int32(7), &orgID},
		err:      pgx.ErrNoRows,
	}))

	artifact, err := store.GetArtifactByIDForUser(context.Background(), GetArtifactByIDForUserInput{
		ID:             "artifact-missing",
		OwnerUserID:    7,
		OrganizationID: &orgID,
	})

	require.ErrorIs(t, err, ErrArtifactNotFound)
	assert.Equal(t, ArtifactRecord{}, artifact)
}

func TestSQLStoreGetArtifactMapsSuccess(t *testing.T) {
	store := NewSQLStore(db.New(fakeArtifactStoreDB{
		t:        t,
		wantArgs: []any{"artifact-1", int32(7), (*int32)(nil)},
		row:      artifactDBRow("artifact-1", nil, db.ArtifactVisibilityPRIVATE),
	}))

	got, err := store.GetArtifactByIDForUser(context.Background(), GetArtifactByIDForUserInput{
		ID:          "artifact-1",
		OwnerUserID: 7,
	})

	require.NoError(t, err)
	assert.Equal(t, "artifact-1", got.ID)
	assert.Equal(t, ArtifactTypeDocument, got.Type)
}

func TestMapArtifactStoreErrorReturnsRawErrors(t *testing.T) {
	expected := errors.New("database unavailable")

	require.ErrorIs(t, mapArtifactStoreError(expected), expected)
}

func TestSQLStoreGetPublicArtifactFileMapsDeveloperFile(t *testing.T) {
	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	tokenHash := "token-hash"
	orgID := int32(12)
	store := NewSQLStore(db.New(fakeArtifactStoreDB{
		t:        t,
		wantArgs: []any{&tokenHash},
		row: []any{
			"file-1",
			int32(7),
			&orgID,
			"report.html",
			"assistants",
			"text/html",
			int64(42),
			"https://blob.example/report.html",
			"users/7/report.html",
			now,
			now,
			pgtype.Timestamp{},
		},
	}))

	file, err := store.GetPublicArtifactFileByTokenHash(context.Background(), tokenHash)

	require.NoError(t, err)
	assert.Equal(t, "file-1", file.ID)
	assert.Equal(t, int32(7), file.UserID)
	assert.Equal(t, "report.html", file.Filename)
	assert.Equal(t, "text/html", file.MimeType)
	assert.Equal(t, int64(42), file.Bytes)
	assert.Equal(t, "https://blob.example/report.html", file.BlobURL)
	assert.Equal(t, "users/7/report.html", file.BlobPath)
	assert.True(t, file.CreatedAt.Equal(now.Time))
}

func TestSQLStoreMapsArtifactVersionAndShareRecords(t *testing.T) {
	createdAt := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(time.Hour)
	deletedAt := updatedAt.Add(time.Hour)
	expiresAt := updatedAt.Add(24 * time.Hour)
	revokedAt := expiresAt.Add(time.Hour)
	orgID := int32(12)
	conversationID := int32(34)
	ownerID := int32(7)
	messageID := "message-1"
	taskID := "task-1"
	currentVersionID := "version-1"
	fileID := "file-1"
	mimeType := "text/html"
	filename := "report.html"
	bytes := int64(42)
	sourceToolName := "create_site"
	sourcePrompt := "make a report"
	tokenHash := "token-hash"

	artifact := artifactRecord(db.Artifact{
		ID:               "artifact-1",
		OrganizationID:   &orgID,
		OwnerUserID:      ownerID,
		ConversationID:   &conversationID,
		MessageID:        &messageID,
		TaskID:           &taskID,
		Type:             db.ArtifactTypeSITE,
		Title:            "Report",
		Status:           db.ArtifactStatusREADY,
		Visibility:       db.ArtifactVisibilityPUBLICLINK,
		CurrentVersionID: &currentVersionID,
		Metadata:         []byte(`{"kind":"site"}`),
		CreatedAt:        pgtype.Timestamp{Time: createdAt, Valid: true},
		UpdatedAt:        pgtype.Timestamp{Time: updatedAt, Valid: true},
		DeletedAt:        pgtype.Timestamp{Time: deletedAt, Valid: true},
	})
	version := artifactVersionRecord(db.ArtifactVersion{
		ID:              currentVersionID,
		ArtifactID:      "artifact-1",
		Version:         2,
		FileID:          &fileID,
		MimeType:        &mimeType,
		Filename:        &filename,
		Bytes:           &bytes,
		RenderMetadata:  []byte(`{"render":"browser"}`),
		SourceToolName:  &sourceToolName,
		SourcePrompt:    &sourcePrompt,
		CreatedByUserID: &ownerID,
		CreatedAt:       pgtype.Timestamp{Time: createdAt, Valid: true},
	})
	share := artifactShareRecord(db.ArtifactShare{
		ID:             "share-1",
		ArtifactID:     "artifact-1",
		OrganizationID: &orgID,
		Scope:          db.ArtifactShareScopePUBLICLINK,
		TokenHash:      &tokenHash,
		Permission:     db.ArtifactPermissionVIEW,
		ExpiresAt:      pgtype.Timestamp{Time: expiresAt, Valid: true},
		CreatedAt:      pgtype.Timestamp{Time: createdAt, Valid: true},
		RevokedAt:      pgtype.Timestamp{Time: revokedAt, Valid: true},
	})

	assert.Equal(t, ArtifactTypeSite, artifact.Type)
	assert.Equal(t, ArtifactStatusReady, artifact.Status)
	assert.Equal(t, ArtifactVisibilityPublicLink, artifact.Visibility)
	require.NotNil(t, artifact.DeletedAt)
	assert.True(t, artifact.DeletedAt.Equal(deletedAt))
	assert.JSONEq(t, `{"kind":"site"}`, string(artifact.Metadata))

	assert.Equal(t, int32(2), version.Version)
	assert.Equal(t, "file-1", *version.FileID)
	assert.Equal(t, "text/html", *version.MimeType)
	assert.Equal(t, int64(42), *version.Bytes)
	assert.JSONEq(t, `{"render":"browser"}`, string(version.RenderMetadata))
	assert.True(t, version.CreatedAt.Equal(createdAt))

	assert.Equal(t, ArtifactShareScopePublicLink, share.Scope)
	assert.Equal(t, ArtifactPermissionView, share.Permission)
	assert.Equal(t, "token-hash", *share.TokenHash)
	require.NotNil(t, share.ExpiresAt)
	assert.True(t, share.ExpiresAt.Equal(expiresAt))
	require.NotNil(t, share.RevokedAt)
	assert.True(t, share.RevokedAt.Equal(revokedAt))
	assert.Nil(t, timestampPtr(pgtype.Timestamp{}))
}

func TestSQLStoreCreateArtifactMapsParamsAndRecord(t *testing.T) {
	orgID := int32(12)
	conversationID := int32(34)
	messageID := "message-1"
	taskID := "task-1"
	metadata := []byte(`{"kind":"document"}`)
	store := NewSQLStore(db.New(fakeArtifactStoreDB{
		t: t,
		wantArgs: []any{
			"artifact-1",
			&orgID,
			int32(7),
			&conversationID,
			&messageID,
			&taskID,
			db.ArtifactTypeDOCUMENT,
			"Report",
			db.ArtifactStatusREADY,
			db.ArtifactVisibilityPRIVATE,
			metadata,
		},
		row: artifactDBRow("artifact-1", &orgID, db.ArtifactVisibilityPRIVATE),
	}))

	artifact, err := store.CreateArtifact(context.Background(), CreateArtifactStoreInput{
		ID:             "artifact-1",
		OrganizationID: &orgID,
		OwnerUserID:    7,
		ConversationID: &conversationID,
		MessageID:      &messageID,
		TaskID:         &taskID,
		Type:           ArtifactTypeDocument,
		Title:          "Report",
		Status:         ArtifactStatusReady,
		Visibility:     ArtifactVisibilityPrivate,
		Metadata:       metadata,
	})

	require.NoError(t, err)
	assert.Equal(t, "artifact-1", artifact.ID)
	assert.Equal(t, ArtifactTypeDocument, artifact.Type)
	assert.Equal(t, ArtifactVisibilityPrivate, artifact.Visibility)
}

func TestSQLStoreCreateArtifactVersionMapsParamsAndRecord(t *testing.T) {
	fileID := "file-1"
	mimeType := "text/html"
	filename := "report.html"
	bytes := int64(512)
	toolName := "create_site"
	prompt := "make a report"
	userID := int32(7)
	renderMetadata := []byte(`{"render":"browser"}`)
	store := NewSQLStore(db.New(fakeArtifactStoreDB{
		t: t,
		wantArgs: []any{
			"version-1",
			"artifact-1",
			int32(2),
			&fileID,
			&mimeType,
			&filename,
			&bytes,
			renderMetadata,
			&toolName,
			&prompt,
			&userID,
		},
		row: artifactVersionDBRow("version-1", 2),
	}))

	version, err := store.CreateArtifactVersion(context.Background(), CreateArtifactVersionStoreInput{
		ID:              "version-1",
		ArtifactID:      "artifact-1",
		Version:         2,
		FileID:          &fileID,
		MimeType:        &mimeType,
		Filename:        &filename,
		Bytes:           &bytes,
		RenderMetadata:  renderMetadata,
		SourceToolName:  &toolName,
		SourcePrompt:    &prompt,
		CreatedByUserID: &userID,
	})

	require.NoError(t, err)
	assert.Equal(t, "version-1", version.ID)
	assert.Equal(t, int32(2), version.Version)
	require.NotNil(t, version.FileID)
	assert.Equal(t, "file-version-1", *version.FileID)
}

func TestSQLStoreArtifactMutationMethodsMapParams(t *testing.T) {
	orgID := int32(12)
	currentVersionID := "version-1"

	t.Run("set current version", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{&currentVersionID, "artifact-1", int32(7), &orgID},
			row:      artifactDBRow("artifact-1", &orgID, db.ArtifactVisibilityPRIVATE),
		}))

		artifact, err := store.SetArtifactCurrentVersion(context.Background(), SetArtifactCurrentVersionInput{
			ID:               "artifact-1",
			CurrentVersionID: currentVersionID,
			OwnerUserID:      7,
			OrganizationID:   &orgID,
		})

		require.NoError(t, err)
		assert.Equal(t, "artifact-1", artifact.ID)
	})

	t.Run("update visibility", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t: t,
			wantArgs: []any{
				db.ArtifactVisibilityORGANIZATION,
				"artifact-1",
				int32(7),
				&orgID,
			},
			row: artifactDBRow("artifact-1", &orgID, db.ArtifactVisibilityORGANIZATION),
		}))

		artifact, err := store.UpdateArtifactVisibilityForOwner(context.Background(), UpdateArtifactVisibilityForOwnerInput{
			ID:             "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
			Visibility:     ArtifactVisibilityOrganization,
		})

		require.NoError(t, err)
		assert.Equal(t, ArtifactVisibilityOrganization, artifact.Visibility)
	})

	t.Run("soft delete", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{"artifact-1", int32(7), &orgID},
			row:      artifactDBRow("artifact-1", &orgID, db.ArtifactVisibilityPRIVATE),
		}))

		artifact, err := store.SoftDeleteArtifactForUser(context.Background(), SoftDeleteArtifactForUserInput{
			ID:             "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.NoError(t, err)
		assert.Equal(t, "artifact-1", artifact.ID)
	})
}

func TestSQLStoreListAndVersionQueriesMapRows(t *testing.T) {
	orgID := int32(12)

	t.Run("list user artifacts", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{int32(7), int32(5), int32(10)},
			queryRows: [][]any{
				artifactDBRow("artifact-1", nil, db.ArtifactVisibilityPRIVATE),
				artifactDBRow("artifact-2", nil, db.ArtifactVisibilityPRIVATE),
			},
		}))

		artifacts, err := store.ListArtifactsForUser(context.Background(), ListArtifactsForUserInput{
			OwnerUserID: 7,
			Offset:      5,
			Limit:       10,
		})

		require.NoError(t, err)
		require.Len(t, artifacts, 2)
		assert.Equal(t, "artifact-2", artifacts[1].ID)
	})

	t.Run("list organization artifacts", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{&orgID, int32(7), int32(0), int32(25)},
			queryRows: [][]any{
				artifactDBRow("artifact-org", &orgID, db.ArtifactVisibilityORGANIZATION),
			},
		}))

		artifacts, err := store.ListArtifactsForUserAndOrg(context.Background(), ListArtifactsForUserAndOrgInput{
			OwnerUserID:    7,
			OrganizationID: &orgID,
			Offset:         0,
			Limit:          25,
		})

		require.NoError(t, err)
		require.Len(t, artifacts, 1)
		assert.Equal(t, ArtifactVisibilityOrganization, artifacts[0].Visibility)
	})

	t.Run("list versions", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{"artifact-1", int32(7), &orgID},
			queryRows: [][]any{
				artifactVersionDBRow("version-2", 2),
				artifactVersionDBRow("version-1", 1),
			},
		}))

		versions, err := store.GetArtifactVersionsForUser(context.Background(), GetArtifactVersionsForUserInput{
			ArtifactID:     "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.NoError(t, err)
		require.Len(t, versions, 2)
		assert.Equal(t, int32(1), versions[1].Version)
	})

	t.Run("list current versions", func(t *testing.T) {
		artifactIDs := []string{"artifact-1", "artifact-2"}
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{artifactIDs, int32(7), &orgID},
			queryRows: [][]any{
				artifactVersionDBRow("version-2", 2),
				artifactVersionDBRow("version-3", 3),
			},
		}))

		versions, err := store.GetCurrentArtifactVersionsForUser(context.Background(), GetCurrentArtifactVersionsForUserInput{
			ArtifactIDs:    artifactIDs,
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.NoError(t, err)
		require.Len(t, versions, 2)
		assert.Equal(t, "version-2", versions[0].ID)
		assert.Equal(t, int32(3), versions[1].Version)
	})

	t.Run("current versions returns query error", func(t *testing.T) {
		expected := errors.New("query failed")
		artifactIDs := []string{"artifact-1"}
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{artifactIDs, int32(7), &orgID},
			queryErr:      expected,
		}))

		_, err := store.GetCurrentArtifactVersionsForUser(context.Background(), GetCurrentArtifactVersionsForUserInput{
			ArtifactIDs:    artifactIDs,
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.ErrorIs(t, err, expected)
	})

	t.Run("current versions returns scan error", func(t *testing.T) {
		expected := errors.New("scan failed")
		artifactIDs := []string{"artifact-1"}
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{artifactIDs, int32(7), &orgID},
			queryRows:     [][]any{artifactVersionDBRow("version-2", 2)},
			queryScanErr:  expected,
		}))

		_, err := store.GetCurrentArtifactVersionsForUser(context.Background(), GetCurrentArtifactVersionsForUserInput{
			ArtifactIDs:    artifactIDs,
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.ErrorIs(t, err, expected)
	})

	t.Run("current versions returns rows iteration error", func(t *testing.T) {
		expected := errors.New("rows failed")
		artifactIDs := []string{"artifact-1"}
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{artifactIDs, int32(7), &orgID},
			queryRowsErr:  expected,
		}))

		_, err := store.GetCurrentArtifactVersionsForUser(context.Background(), GetCurrentArtifactVersionsForUserInput{
			ArtifactIDs:    artifactIDs,
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.ErrorIs(t, err, expected)
	})
}

func TestSQLStorePublicShareMethodsMapParamsAndRows(t *testing.T) {
	orgID := int32(12)
	tokenHash := "token-hash"

	t.Run("create public link share", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{"share-1", &tokenHash, "artifact-1", int32(7), &orgID},
			row:      artifactShareDBRow("share-1", "artifact-1", &orgID, &tokenHash),
		}))

		share, err := store.CreateArtifactPublicLinkShare(context.Background(), CreateArtifactPublicLinkShareInput{
			ID:             "share-1",
			ArtifactID:     "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
			TokenHash:      tokenHash,
		})

		require.NoError(t, err)
		assert.Equal(t, ArtifactShareScopePublicLink, share.Scope)
		require.NotNil(t, share.TokenHash)
		assert.Equal(t, tokenHash, *share.TokenHash)
	})

	t.Run("get public artifact", func(t *testing.T) {
		row := append([]any{}, artifactDBRow("artifact-1", &orgID, db.ArtifactVisibilityPUBLICLINK)...)
		row = append(row, artifactVersionDBRow("version-1", 1)...)
		row = append(row, artifactShareDBRow("share-1", "artifact-1", &orgID, &tokenHash)...)
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{&tokenHash},
			row:      row,
		}))

		publicArtifact, err := store.GetPublicArtifactByTokenHash(context.Background(), tokenHash)

		require.NoError(t, err)
		assert.Equal(t, "artifact-1", publicArtifact.Artifact.ID)
		assert.Equal(t, "version-1", publicArtifact.Version.ID)
		assert.Equal(t, "share-1", publicArtifact.Share.ID)
	})

	t.Run("revoke public links", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:            t,
			execWantArgs: []any{"artifact-1", int32(7), &orgID},
		}))

		err := store.RevokeArtifactPublicLinkSharesForOwner(context.Background(), RevokeArtifactPublicLinkSharesForOwnerInput{
			ArtifactID:     "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.NoError(t, err)
	})
}

func TestSQLStoreSoftDeleteArtifactFilesMapsArgsAndErrors(t *testing.T) {
	orgID := int32(12)
	expected := assert.AnError
	store := NewSQLStore(db.New(fakeArtifactStoreDB{
		t:            t,
		execWantArgs: []any{[]string{"file-1", "file-2"}, int32(7), &orgID},
		execErr:      expected,
	}))

	err := store.SoftDeleteArtifactFilesForUser(context.Background(), SoftDeleteArtifactFilesForUserInput{
		FileIDs:        []string{"file-1", "file-2"},
		OwnerUserID:    7,
		OrganizationID: &orgID,
	})

	require.ErrorIs(t, err, expected)
}

func TestSQLStoreMapsWrapperErrors(t *testing.T) {
	orgID := int32(12)
	expected := errors.New("database unavailable")

	t.Run("create artifact maps no rows", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{"artifact-1", (*int32)(nil), int32(7), (*int32)(nil), (*string)(nil), (*string)(nil), db.ArtifactTypeDOCUMENT, "Report", db.ArtifactStatusREADY, db.ArtifactVisibilityPRIVATE, []byte(nil)},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.CreateArtifact(context.Background(), CreateArtifactStoreInput{
			ID:          "artifact-1",
			OwnerUserID: 7,
			Type:        ArtifactTypeDocument,
			Title:       "Report",
			Status:      ArtifactStatusReady,
			Visibility:  ArtifactVisibilityPrivate,
		})

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("create version returns raw error", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{"version-1", "artifact-1", int32(1), (*string)(nil), (*string)(nil), (*string)(nil), (*int64)(nil), []byte(nil), (*string)(nil), (*string)(nil), (*int32)(nil)},
			err:      expected,
		}))

		_, err := store.CreateArtifactVersion(context.Background(), CreateArtifactVersionStoreInput{
			ID:         "version-1",
			ArtifactID: "artifact-1",
			Version:    1,
		})

		require.ErrorIs(t, err, expected)
	})

	t.Run("set current version maps no rows", func(t *testing.T) {
		currentVersionID := "version-1"
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{&currentVersionID, "artifact-1", int32(7), &orgID},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.SetArtifactCurrentVersion(context.Background(), SetArtifactCurrentVersionInput{
			ID:               "artifact-1",
			CurrentVersionID: currentVersionID,
			OwnerUserID:      7,
			OrganizationID:   &orgID,
		})

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("list artifacts returns query error", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{int32(7), int32(0), int32(10)},
			queryErr:      expected,
		}))

		_, err := store.ListArtifactsForUser(context.Background(), ListArtifactsForUserInput{
			OwnerUserID: 7,
			Limit:       10,
		})

		require.ErrorIs(t, err, expected)
	})

	t.Run("list organization artifacts returns query error", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{&orgID, int32(7), int32(0), int32(10)},
			queryErr:      expected,
		}))

		_, err := store.ListArtifactsForUserAndOrg(context.Background(), ListArtifactsForUserAndOrgInput{
			OwnerUserID:    7,
			OrganizationID: &orgID,
			Limit:          10,
		})

		require.ErrorIs(t, err, expected)
	})

	t.Run("versions returns query error", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:             t,
			queryWantArgs: []any{"artifact-1", int32(7), &orgID},
			queryErr:      expected,
		}))

		_, err := store.GetArtifactVersionsForUser(context.Background(), GetArtifactVersionsForUserInput{
			ArtifactID:     "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.ErrorIs(t, err, expected)
	})

	t.Run("visibility maps no rows", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{db.ArtifactVisibilityPRIVATE, "artifact-1", int32(7), &orgID},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.UpdateArtifactVisibilityForOwner(context.Background(), UpdateArtifactVisibilityForOwnerInput{
			ID:             "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
			Visibility:     ArtifactVisibilityPrivate,
		})

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("create share maps no rows", func(t *testing.T) {
		tokenHash := "token-hash"
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{"share-1", &tokenHash, "artifact-1", int32(7), &orgID},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.CreateArtifactPublicLinkShare(context.Background(), CreateArtifactPublicLinkShareInput{
			ID:             "share-1",
			ArtifactID:     "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
			TokenHash:      tokenHash,
		})

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("public artifact maps no rows", func(t *testing.T) {
		tokenHash := "token-hash"
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{&tokenHash},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.GetPublicArtifactByTokenHash(context.Background(), tokenHash)

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("public file maps no rows", func(t *testing.T) {
		tokenHash := "token-hash"
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{&tokenHash},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.GetPublicArtifactFileByTokenHash(context.Background(), tokenHash)

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("soft delete maps no rows", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:        t,
			wantArgs: []any{"artifact-1", int32(7), &orgID},
			err:      pgx.ErrNoRows,
		}))

		_, err := store.SoftDeleteArtifactForUser(context.Background(), SoftDeleteArtifactForUserInput{
			ID:             "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.ErrorIs(t, err, ErrArtifactNotFound)
	})

	t.Run("revoke links returns exec error", func(t *testing.T) {
		store := NewSQLStore(db.New(fakeArtifactStoreDB{
			t:            t,
			execWantArgs: []any{"artifact-1", int32(7), &orgID},
			execErr:      expected,
		}))

		err := store.RevokeArtifactPublicLinkSharesForOwner(context.Background(), RevokeArtifactPublicLinkSharesForOwnerInput{
			ArtifactID:     "artifact-1",
			OwnerUserID:    7,
			OrganizationID: &orgID,
		})

		require.ErrorIs(t, err, expected)
	})
}
