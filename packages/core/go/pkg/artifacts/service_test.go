package artifacts

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubArtifactStore struct {
	createArtifactFunc             func(ctx context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error)
	createArtifactVersionFunc      func(ctx context.Context, input CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error)
	setArtifactCurrentVersionFunc  func(ctx context.Context, input SetArtifactCurrentVersionInput) (ArtifactRecord, error)
	getArtifactByIDForUserFunc     func(ctx context.Context, input GetArtifactByIDForUserInput) (ArtifactRecord, error)
	listArtifactsForUserFunc       func(ctx context.Context, input ListArtifactsForUserInput) ([]ArtifactRecord, error)
	listArtifactsForUserAndOrgFunc func(ctx context.Context, input ListArtifactsForUserAndOrgInput) ([]ArtifactRecord, error)
	getArtifactVersionsForUserFunc func(ctx context.Context, input GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error)
	updateArtifactVisibilityFunc   func(ctx context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error)
	createPublicLinkShareFunc      func(ctx context.Context, input CreateArtifactPublicLinkShareInput) (ArtifactShareRecord, error)
	revokePublicLinkSharesFunc     func(ctx context.Context, input RevokeArtifactPublicLinkSharesForOwnerInput) error
	getPublicArtifactFunc          func(ctx context.Context, tokenHash string) (PublicArtifactRecord, error)
	getPublicArtifactFileFunc      func(ctx context.Context, tokenHash string) (PublicArtifactFileRecord, error)
	softDeleteArtifactForUserFunc  func(ctx context.Context, input SoftDeleteArtifactForUserInput) (ArtifactRecord, error)
	softDeleteArtifactFilesFunc    func(ctx context.Context, input SoftDeleteArtifactFilesForUserInput) error
}

type batchArtifactStore struct {
	stubArtifactStore
	currentVersionsFunc func(ctx context.Context, input GetCurrentArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error)
}

type atomicArtifactStore struct {
	stubArtifactStore
	createInitialFunc func(
		ctx context.Context,
		artifact CreateArtifactStoreInput,
		version CreateArtifactVersionStoreInput,
	) (ArtifactRecord, ArtifactVersionRecord, error)
}

func (s atomicArtifactStore) CreateArtifactWithInitialVersion(
	ctx context.Context,
	artifact CreateArtifactStoreInput,
	version CreateArtifactVersionStoreInput,
) (ArtifactRecord, ArtifactVersionRecord, error) {
	return s.createInitialFunc(ctx, artifact, version)
}

func (s batchArtifactStore) GetCurrentArtifactVersionsForUser(ctx context.Context, input GetCurrentArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
	return s.currentVersionsFunc(ctx, input)
}

func (s stubArtifactStore) CreateArtifact(ctx context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error) {
	return s.createArtifactFunc(ctx, input)
}

func (s stubArtifactStore) CreateArtifactWithInitialVersion(
	ctx context.Context,
	artifactInput CreateArtifactStoreInput,
	versionInput CreateArtifactVersionStoreInput,
) (ArtifactRecord, ArtifactVersionRecord, error) {
	artifact, err := s.CreateArtifact(ctx, artifactInput)
	if err != nil {
		return ArtifactRecord{}, ArtifactVersionRecord{}, err
	}
	versionInput.ArtifactID = artifact.ID
	version, err := s.CreateArtifactVersion(ctx, versionInput)
	if err != nil {
		return ArtifactRecord{}, ArtifactVersionRecord{}, err
	}
	artifact, err = s.SetArtifactCurrentVersion(ctx, SetArtifactCurrentVersionInput{
		ID:               artifact.ID,
		CurrentVersionID: version.ID,
		OwnerUserID:      artifactInput.OwnerUserID,
		OrganizationID:   artifactInput.OrganizationID,
	})
	return artifact, version, err
}

func (s stubArtifactStore) CreateArtifactVersion(ctx context.Context, input CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error) {
	return s.createArtifactVersionFunc(ctx, input)
}

func (s stubArtifactStore) SetArtifactCurrentVersion(ctx context.Context, input SetArtifactCurrentVersionInput) (ArtifactRecord, error) {
	return s.setArtifactCurrentVersionFunc(ctx, input)
}

func (s stubArtifactStore) GetArtifactByIDForUser(ctx context.Context, input GetArtifactByIDForUserInput) (ArtifactRecord, error) {
	return s.getArtifactByIDForUserFunc(ctx, input)
}

func (s stubArtifactStore) ListArtifactsForUser(ctx context.Context, input ListArtifactsForUserInput) ([]ArtifactRecord, error) {
	return s.listArtifactsForUserFunc(ctx, input)
}

func (s stubArtifactStore) ListArtifactsForUserAndOrg(ctx context.Context, input ListArtifactsForUserAndOrgInput) ([]ArtifactRecord, error) {
	return s.listArtifactsForUserAndOrgFunc(ctx, input)
}

func (s stubArtifactStore) GetArtifactVersionsForUser(ctx context.Context, input GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
	return s.getArtifactVersionsForUserFunc(ctx, input)
}

func (s stubArtifactStore) UpdateArtifactVisibilityForOwner(ctx context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
	return s.updateArtifactVisibilityFunc(ctx, input)
}

func (s stubArtifactStore) CreateArtifactPublicLinkShare(ctx context.Context, input CreateArtifactPublicLinkShareInput) (ArtifactShareRecord, error) {
	return s.createPublicLinkShareFunc(ctx, input)
}

func (s stubArtifactStore) RevokeArtifactPublicLinkSharesForOwner(ctx context.Context, input RevokeArtifactPublicLinkSharesForOwnerInput) error {
	return s.revokePublicLinkSharesFunc(ctx, input)
}

func (s stubArtifactStore) GetPublicArtifactByTokenHash(ctx context.Context, tokenHash string) (PublicArtifactRecord, error) {
	return s.getPublicArtifactFunc(ctx, tokenHash)
}

func (s stubArtifactStore) GetPublicArtifactFileByTokenHash(ctx context.Context, tokenHash string) (PublicArtifactFileRecord, error) {
	return s.getPublicArtifactFileFunc(ctx, tokenHash)
}

func (s stubArtifactStore) SoftDeleteArtifactForUser(ctx context.Context, input SoftDeleteArtifactForUserInput) (ArtifactRecord, error) {
	return s.softDeleteArtifactForUserFunc(ctx, input)
}

func (s stubArtifactStore) SoftDeleteArtifactFilesForUser(ctx context.Context, input SoftDeleteArtifactFilesForUserInput) error {
	if s.softDeleteArtifactFilesFunc == nil {
		return nil
	}
	return s.softDeleteArtifactFilesFunc(ctx, input)
}

func TestCreateArtifactWithInitialVersionCreatesVersionAndSetsCurrent(t *testing.T) {
	now := time.Now()
	orgID := int32(9)
	fileID := "file-1"
	filename := "report.xlsx"
	var createdArtifactID string

	svc := NewService(stubArtifactStore{
		createArtifactFunc: func(_ context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error) {
			require.NotEmpty(t, input.ID)
			createdArtifactID = input.ID
			assert.Equal(t, &orgID, input.OrganizationID)
			assert.Equal(t, int32(42), input.OwnerUserID)
			assert.Equal(t, ArtifactTypeSpreadsheet, input.Type)
			assert.Equal(t, "Quarterly model", input.Title)
			assert.Equal(t, ArtifactStatusReady, input.Status)
			assert.Equal(t, ArtifactVisibilityPrivate, input.Visibility)
			return ArtifactRecord{
				ID:             input.ID,
				OrganizationID: input.OrganizationID,
				OwnerUserID:    input.OwnerUserID,
				Type:           input.Type,
				Title:          input.Title,
				Status:         input.Status,
				Visibility:     input.Visibility,
				CreatedAt:      now,
				UpdatedAt:      now,
			}, nil
		},
		createArtifactVersionFunc: func(_ context.Context, input CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error) {
			require.NotEmpty(t, input.ID)
			assert.Equal(t, createdArtifactID, input.ArtifactID)
			assert.Equal(t, int32(1), input.Version)
			assert.Equal(t, &fileID, input.FileID)
			assert.Equal(t, &filename, input.Filename)
			return ArtifactVersionRecord{
				ID:         input.ID,
				ArtifactID: input.ArtifactID,
				Version:    input.Version,
				FileID:     input.FileID,
				Filename:   input.Filename,
				CreatedAt:  now,
			}, nil
		},
		setArtifactCurrentVersionFunc: func(_ context.Context, input SetArtifactCurrentVersionInput) (ArtifactRecord, error) {
			assert.Equal(t, createdArtifactID, input.ID)
			assert.NotEmpty(t, input.CurrentVersionID)
			assert.Equal(t, int32(42), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return ArtifactRecord{
				ID:               input.ID,
				OrganizationID:   input.OrganizationID,
				OwnerUserID:      input.OwnerUserID,
				Type:             ArtifactTypeSpreadsheet,
				Title:            "Quarterly model",
				Status:           ArtifactStatusReady,
				Visibility:       ArtifactVisibilityPrivate,
				CurrentVersionID: &input.CurrentVersionID,
				CreatedAt:        now,
				UpdatedAt:        now,
			}, nil
		},
	})

	result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
		OrganizationID: &orgID,
		OwnerUserID:    42,
		Type:           ArtifactTypeSpreadsheet,
		Title:          " Quarterly model ",
		FileID:         &fileID,
		Filename:       &filename,
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, createdArtifactID, result.Artifact.ID)
	assert.Equal(t, createdArtifactID, result.Version.ArtifactID)
	require.NotNil(t, result.Artifact.CurrentVersionID)
	assert.Equal(t, result.Version.ID, *result.Artifact.CurrentVersionID)
}

func TestCreateArtifactWithInitialVersionUsesAtomicStore(t *testing.T) {
	now := time.Now()
	storeErr := errors.New("transaction failed")

	t.Run("success", func(t *testing.T) {
		svc := NewService(atomicArtifactStore{
			createInitialFunc: func(_ context.Context, artifactInput CreateArtifactStoreInput, versionInput CreateArtifactVersionStoreInput) (ArtifactRecord, ArtifactVersionRecord, error) {
				require.NotEmpty(t, artifactInput.ID)
				require.NotEmpty(t, versionInput.ID)
				assert.Equal(t, artifactInput.ID, versionInput.ArtifactID)
				assert.Equal(t, "Atomic artifact", artifactInput.Title)
				currentVersionID := versionInput.ID
				return ArtifactRecord{
						ID:               artifactInput.ID,
						OwnerUserID:      artifactInput.OwnerUserID,
						Type:             artifactInput.Type,
						Title:            artifactInput.Title,
						Status:           artifactInput.Status,
						Visibility:       artifactInput.Visibility,
						CurrentVersionID: &currentVersionID,
						CreatedAt:        now,
						UpdatedAt:        now,
					}, ArtifactVersionRecord{
						ID:         versionInput.ID,
						ArtifactID: versionInput.ArtifactID,
						Version:    versionInput.Version,
						CreatedAt:  now,
					}, nil
			},
		})

		result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
			OwnerUserID: 42,
			Title:       " Atomic artifact ",
		})

		require.NoError(t, err)
		require.NotNil(t, result)
		assert.Equal(t, result.Version.ID, *result.Artifact.CurrentVersionID)
	})

	t.Run("error", func(t *testing.T) {
		svc := NewService(atomicArtifactStore{
			createInitialFunc: func(context.Context, CreateArtifactStoreInput, CreateArtifactVersionStoreInput) (ArtifactRecord, ArtifactVersionRecord, error) {
				return ArtifactRecord{}, ArtifactVersionRecord{}, storeErr
			},
		})

		result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
			OwnerUserID: 42,
			Title:       "Atomic artifact",
		})

		require.ErrorIs(t, err, storeErr)
		assert.Nil(t, result)
	})
}

func TestCreateArtifactWithInitialVersionRejectsInvalidInput(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
		OwnerUserID: 0,
		Title:       " ",
	})

	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, result)
}

func TestCreateArtifactWithInitialVersionDefaultsTypeAndVisibility(t *testing.T) {
	now := time.Now()
	var artifactID string
	svc := NewService(stubArtifactStore{
		createArtifactFunc: func(_ context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error) {
			artifactID = input.ID
			assert.Equal(t, ArtifactTypeOther, input.Type)
			assert.Equal(t, ArtifactVisibilityPrivate, input.Visibility)
			assert.Equal(t, "Untyped artifact", input.Title)
			return ArtifactRecord{
				ID:          input.ID,
				OwnerUserID: input.OwnerUserID,
				Type:        input.Type,
				Title:       input.Title,
				Status:      input.Status,
				Visibility:  input.Visibility,
				CreatedAt:   now,
				UpdatedAt:   now,
			}, nil
		},
		createArtifactVersionFunc: func(_ context.Context, input CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error) {
			return ArtifactVersionRecord{
				ID:         input.ID,
				ArtifactID: input.ArtifactID,
				Version:    input.Version,
				CreatedAt:  now,
			}, nil
		},
		setArtifactCurrentVersionFunc: func(_ context.Context, input SetArtifactCurrentVersionInput) (ArtifactRecord, error) {
			return ArtifactRecord{
				ID:               artifactID,
				OwnerUserID:      input.OwnerUserID,
				Type:             ArtifactTypeOther,
				Title:            "Untyped artifact",
				Status:           ArtifactStatusReady,
				Visibility:       ArtifactVisibilityPrivate,
				CurrentVersionID: &input.CurrentVersionID,
				CreatedAt:        now,
				UpdatedAt:        now,
			}, nil
		},
	})

	result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
		OwnerUserID: 7,
		Title:       " Untyped artifact ",
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, ArtifactTypeOther, result.Artifact.Type)
	assert.Equal(t, ArtifactVisibilityPrivate, result.Artifact.Visibility)
}

func TestCreateArtifactWithInitialVersionPropagatesStoreErrors(t *testing.T) {
	expected := errors.New("store failed")

	t.Run("create artifact", func(t *testing.T) {
		svc := NewService(stubArtifactStore{
			createArtifactFunc: func(_ context.Context, _ CreateArtifactStoreInput) (ArtifactRecord, error) {
				return ArtifactRecord{}, expected
			},
		})

		result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
			OwnerUserID: 7,
			Title:       "Artifact",
		})

		require.ErrorIs(t, err, expected)
		assert.Nil(t, result)
	})

	t.Run("create version", func(t *testing.T) {
		svc := NewService(stubArtifactStore{
			createArtifactFunc: func(_ context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error) {
				return ArtifactRecord{ID: input.ID, OwnerUserID: input.OwnerUserID}, nil
			},
			createArtifactVersionFunc: func(_ context.Context, _ CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error) {
				return ArtifactVersionRecord{}, expected
			},
		})

		result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
			OwnerUserID: 7,
			Title:       "Artifact",
		})

		require.ErrorIs(t, err, expected)
		assert.Nil(t, result)
	})

	t.Run("set current version", func(t *testing.T) {
		svc := NewService(stubArtifactStore{
			createArtifactFunc: func(_ context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error) {
				return ArtifactRecord{ID: input.ID, OwnerUserID: input.OwnerUserID}, nil
			},
			createArtifactVersionFunc: func(_ context.Context, input CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error) {
				return ArtifactVersionRecord{ID: input.ID, ArtifactID: input.ArtifactID, Version: 1}, nil
			},
			setArtifactCurrentVersionFunc: func(_ context.Context, _ SetArtifactCurrentVersionInput) (ArtifactRecord, error) {
				return ArtifactRecord{}, expected
			},
		})

		result, err := svc.CreateArtifactWithInitialVersion(context.Background(), CreateArtifactInput{
			OwnerUserID: 7,
			Title:       "Artifact",
		})

		require.ErrorIs(t, err, expected)
		assert.Nil(t, result)
	})
}

func TestListArtifactsUsesOrgScopedStore(t *testing.T) {
	orgID := int32(11)
	svc := NewService(stubArtifactStore{
		listArtifactsForUserAndOrgFunc: func(_ context.Context, input ListArtifactsForUserAndOrgInput) ([]ArtifactRecord, error) {
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			assert.Equal(t, int32(50), input.Limit)
			assert.Equal(t, int32(0), input.Offset)
			return []ArtifactRecord{{ID: "artifact-1", OwnerUserID: input.OwnerUserID, OrganizationID: input.OrganizationID}}, nil
		},
	})

	artifacts, err := svc.ListArtifacts(context.Background(), 7, &orgID, 0, -4)

	require.NoError(t, err)
	require.Len(t, artifacts, 1)
	assert.Equal(t, "artifact-1", artifacts[0].ID)
}

func TestListArtifactsReturnsStoreError(t *testing.T) {
	expected := errors.New("db down")
	svc := NewService(stubArtifactStore{
		listArtifactsForUserFunc: func(_ context.Context, _ ListArtifactsForUserInput) ([]ArtifactRecord, error) {
			return nil, expected
		},
	})

	artifacts, err := svc.ListArtifacts(context.Background(), 7, nil, 10, 0)

	require.ErrorIs(t, err, expected)
	assert.Nil(t, artifacts)
}

func TestListArtifactsRejectsInvalidOwner(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	artifacts, err := svc.ListArtifacts(context.Background(), 0, nil, 10, 0)

	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, artifacts)
}

func TestGetArtifactDelegatesToOwnerScopedStore(t *testing.T) {
	orgID := int32(11)
	svc := NewService(stubArtifactStore{
		getArtifactByIDForUserFunc: func(_ context.Context, input GetArtifactByIDForUserInput) (ArtifactRecord, error) {
			assert.Equal(t, "artifact-1", input.ID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return ArtifactRecord{
				ID:             input.ID,
				OwnerUserID:    input.OwnerUserID,
				OrganizationID: input.OrganizationID,
				Type:           ArtifactTypeDocument,
				Title:          "Research brief",
				Status:         ArtifactStatusReady,
				Visibility:     ArtifactVisibilityPrivate,
			}, nil
		},
	})

	artifact, err := svc.GetArtifact(context.Background(), "artifact-1", 7, &orgID)

	require.NoError(t, err)
	require.NotNil(t, artifact)
	assert.Equal(t, "artifact-1", artifact.ID)
	assert.Equal(t, ArtifactTypeDocument, artifact.Type)
}

func TestGetArtifactRejectsInvalidInput(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	artifact, err := svc.GetArtifact(context.Background(), " ", 7, nil)

	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, artifact)
}

func TestGetArtifactReturnsStoreError(t *testing.T) {
	expected := errors.New("get failed")
	svc := NewService(stubArtifactStore{
		getArtifactByIDForUserFunc: func(_ context.Context, _ GetArtifactByIDForUserInput) (ArtifactRecord, error) {
			return ArtifactRecord{}, expected
		},
	})

	artifact, err := svc.GetArtifact(context.Background(), "artifact-1", 7, nil)

	require.ErrorIs(t, err, expected)
	assert.Nil(t, artifact)
}

func TestGetArtifactVersionsDelegatesToStore(t *testing.T) {
	orgID := int32(11)
	svc := NewService(stubArtifactStore{
		getArtifactVersionsForUserFunc: func(_ context.Context, input GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
			assert.Equal(t, "artifact-1", input.ArtifactID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return []ArtifactVersionRecord{
				{ID: "version-1", ArtifactID: input.ArtifactID, Version: 1},
				{ID: "version-2", ArtifactID: input.ArtifactID, Version: 2},
			}, nil
		},
	})

	versions, err := svc.GetArtifactVersions(context.Background(), "artifact-1", 7, &orgID)

	require.NoError(t, err)
	require.Len(t, versions, 2)
	assert.Equal(t, int32(2), versions[1].Version)
}

func TestGetArtifactCurrentVersionsUsesBatchStore(t *testing.T) {
	orgID := int32(11)
	svc := NewService(batchArtifactStore{
		currentVersionsFunc: func(_ context.Context, input GetCurrentArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
			assert.Equal(t, []string{"artifact-1", "artifact-2"}, input.ArtifactIDs)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return []ArtifactVersionRecord{
				{ID: "version-1", ArtifactID: "artifact-1", Version: 1},
				{ID: "version-2", ArtifactID: "artifact-2", Version: 2},
			}, nil
		},
	})

	versions, err := svc.GetArtifactCurrentVersions(context.Background(), []string{" artifact-1 ", "artifact-2", "artifact-1", " "}, 7, &orgID)

	require.NoError(t, err)
	require.Len(t, versions, 2)
	assert.Equal(t, "version-1", versions["artifact-1"].ID)
	assert.Equal(t, int32(2), versions["artifact-2"].Version)
}

func TestGetArtifactCurrentVersionsEdges(t *testing.T) {
	t.Run("rejects invalid owner", func(t *testing.T) {
		svc := NewService(stubArtifactStore{})

		versions, err := svc.GetArtifactCurrentVersions(context.Background(), []string{"artifact-1"}, 0, nil)

		require.ErrorIs(t, err, ErrInvalidArtifactInput)
		assert.Nil(t, versions)
	})

	t.Run("returns empty map for empty cleaned ids", func(t *testing.T) {
		svc := NewService(stubArtifactStore{})

		versions, err := svc.GetArtifactCurrentVersions(context.Background(), []string{" ", ""}, 7, nil)

		require.NoError(t, err)
		assert.Empty(t, versions)
	})

	t.Run("returns batch store error", func(t *testing.T) {
		expected := errors.New("batch failed")
		svc := NewService(batchArtifactStore{
			currentVersionsFunc: func(context.Context, GetCurrentArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				return nil, expected
			},
		})

		versions, err := svc.GetArtifactCurrentVersions(context.Background(), []string{"artifact-1"}, 7, nil)

		require.ErrorIs(t, err, expected)
		assert.Nil(t, versions)
	})

	t.Run("falls back to per artifact versions", func(t *testing.T) {
		svc := NewService(stubArtifactStore{
			getArtifactVersionsForUserFunc: func(_ context.Context, input GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				if input.ArtifactID == "missing" {
					return nil, nil
				}
				return []ArtifactVersionRecord{{ID: "version-" + input.ArtifactID, ArtifactID: input.ArtifactID, Version: 2}}, nil
			},
		})

		versions, err := svc.GetArtifactCurrentVersions(context.Background(), []string{"artifact-1", "missing"}, 7, nil)

		require.NoError(t, err)
		require.Len(t, versions, 1)
		assert.Equal(t, "version-artifact-1", versions["artifact-1"].ID)
	})

	t.Run("returns fallback store error", func(t *testing.T) {
		expected := errors.New("versions failed")
		svc := NewService(stubArtifactStore{
			getArtifactVersionsForUserFunc: func(context.Context, GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				return nil, expected
			},
		})

		versions, err := svc.GetArtifactCurrentVersions(context.Background(), []string{"artifact-1"}, 7, nil)

		require.ErrorIs(t, err, expected)
		assert.Nil(t, versions)
	})
}

func TestGetArtifactVersionsReturnsStoreError(t *testing.T) {
	expected := errors.New("versions failed")
	svc := NewService(stubArtifactStore{
		getArtifactVersionsForUserFunc: func(_ context.Context, _ GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
			return nil, expected
		},
	})

	versions, err := svc.GetArtifactVersions(context.Background(), "artifact-1", 7, nil)

	require.ErrorIs(t, err, expected)
	assert.Nil(t, versions)
}

func TestGetArtifactVersionsRejectsInvalidInput(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	versions, err := svc.GetArtifactVersions(context.Background(), " ", 7, nil)

	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, versions)
}

func TestDeleteArtifactSoftDeletesOwnerScopedArtifact(t *testing.T) {
	orgID := int32(11)
	fileID := "file-1"
	duplicateFileID := "file-1"
	secondFileID := "file-2"
	blankFileID := " "
	svc := NewService(stubArtifactStore{
		getArtifactVersionsForUserFunc: func(_ context.Context, input GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
			assert.Equal(t, "artifact-1", input.ArtifactID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return []ArtifactVersionRecord{
				{ID: "version-1", ArtifactID: input.ArtifactID, Version: 1, FileID: &fileID},
				{ID: "version-2", ArtifactID: input.ArtifactID, Version: 2, FileID: &duplicateFileID},
				{ID: "version-3", ArtifactID: input.ArtifactID, Version: 3, FileID: &secondFileID},
				{ID: "version-4", ArtifactID: input.ArtifactID, Version: 4, FileID: &blankFileID},
				{ID: "version-5", ArtifactID: input.ArtifactID, Version: 5},
			}, nil
		},
		softDeleteArtifactForUserFunc: func(_ context.Context, input SoftDeleteArtifactForUserInput) (ArtifactRecord, error) {
			assert.Equal(t, "artifact-1", input.ID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return ArtifactRecord{ID: input.ID, OwnerUserID: input.OwnerUserID}, nil
		},
		softDeleteArtifactFilesFunc: func(_ context.Context, input SoftDeleteArtifactFilesForUserInput) error {
			assert.Equal(t, []string{"file-1", "file-2"}, input.FileIDs)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return nil
		},
	})

	err := svc.DeleteArtifact(context.Background(), "artifact-1", 7, &orgID)

	require.NoError(t, err)
}

func TestDeleteArtifactRejectsInvalidInput(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	err := svc.DeleteArtifact(context.Background(), "artifact-1", 0, nil)

	require.ErrorIs(t, err, ErrInvalidArtifactInput)
}

func TestDeleteArtifactPropagatesStoreErrorsAndSkipsFileDeleteWithoutFiles(t *testing.T) {
	expected := errors.New("delete failed")

	t.Run("version lookup", func(t *testing.T) {
		svc := NewService(stubArtifactStore{
			getArtifactVersionsForUserFunc: func(_ context.Context, _ GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				return nil, expected
			},
		})

		err := svc.DeleteArtifact(context.Background(), "artifact-1", 7, nil)

		require.ErrorIs(t, err, expected)
	})

	t.Run("artifact delete", func(t *testing.T) {
		svc := NewService(stubArtifactStore{
			getArtifactVersionsForUserFunc: func(_ context.Context, _ GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				return []ArtifactVersionRecord{}, nil
			},
			softDeleteArtifactForUserFunc: func(_ context.Context, _ SoftDeleteArtifactForUserInput) (ArtifactRecord, error) {
				return ArtifactRecord{}, expected
			},
		})

		err := svc.DeleteArtifact(context.Background(), "artifact-1", 7, nil)

		require.ErrorIs(t, err, expected)
	})

	t.Run("no file versions", func(t *testing.T) {
		filesDeleted := false
		svc := NewService(stubArtifactStore{
			getArtifactVersionsForUserFunc: func(_ context.Context, _ GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				return []ArtifactVersionRecord{{ID: "version-1"}}, nil
			},
			softDeleteArtifactForUserFunc: func(_ context.Context, input SoftDeleteArtifactForUserInput) (ArtifactRecord, error) {
				return ArtifactRecord{ID: input.ID, OwnerUserID: input.OwnerUserID}, nil
			},
			softDeleteArtifactFilesFunc: func(_ context.Context, _ SoftDeleteArtifactFilesForUserInput) error {
				filesDeleted = true
				return nil
			},
		})

		err := svc.DeleteArtifact(context.Background(), "artifact-1", 7, nil)

		require.NoError(t, err)
		assert.False(t, filesDeleted)
	})

	t.Run("file delete", func(t *testing.T) {
		fileID := "file-1"
		svc := NewService(stubArtifactStore{
			getArtifactVersionsForUserFunc: func(_ context.Context, _ GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error) {
				return []ArtifactVersionRecord{{ID: "version-1", FileID: &fileID}}, nil
			},
			softDeleteArtifactForUserFunc: func(_ context.Context, input SoftDeleteArtifactForUserInput) (ArtifactRecord, error) {
				return ArtifactRecord{ID: input.ID, OwnerUserID: input.OwnerUserID}, nil
			},
			softDeleteArtifactFilesFunc: func(_ context.Context, _ SoftDeleteArtifactFilesForUserInput) error {
				return expected
			},
		})

		err := svc.DeleteArtifact(context.Background(), "artifact-1", 7, nil)

		require.ErrorIs(t, err, expected)
	})
}
