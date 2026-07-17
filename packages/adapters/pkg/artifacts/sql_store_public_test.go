package artifacts

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
