package artifacts

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateArtifactVisibilityAllowsOrganizationVisibilityWithOrg(t *testing.T) {
	orgID := int32(13)
	svc := NewService(stubArtifactStore{
		updateArtifactVisibilityFunc: func(_ context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			assert.Equal(t, "artifact-1", input.ID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			assert.Equal(t, ArtifactVisibilityOrganization, input.Visibility)
			return ArtifactRecord{
				ID:             input.ID,
				OwnerUserID:    input.OwnerUserID,
				OrganizationID: input.OrganizationID,
				Visibility:     input.Visibility,
			}, nil
		},
	})

	artifact, err := svc.UpdateArtifactVisibility(context.Background(), "artifact-1", 7, &orgID, ArtifactVisibilityOrganization)

	require.NoError(t, err)
	require.NotNil(t, artifact)
	assert.Equal(t, ArtifactVisibilityOrganization, artifact.Visibility)
}

func TestUpdateArtifactVisibilityRejectsInvalidVisibility(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	for name, visibility := range map[string]ArtifactVisibility{
		"organization without org":  ArtifactVisibilityOrganization,
		"public link without share": ArtifactVisibilityPublicLink,
		"unknown":                   "unknown",
	} {
		t.Run(name, func(t *testing.T) {
			artifact, err := svc.UpdateArtifactVisibility(context.Background(), "artifact-1", 7, nil, visibility)
			require.ErrorIs(t, err, ErrInvalidArtifactInput)
			assert.Nil(t, artifact)
		})
	}
}

func TestUpdateArtifactVisibilityReturnsStoreError(t *testing.T) {
	expected := errors.New("visibility failed")
	svc := NewService(stubArtifactStore{
		updateArtifactVisibilityFunc: func(_ context.Context, _ UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			return ArtifactRecord{}, expected
		},
	})

	artifact, err := svc.UpdateArtifactVisibility(context.Background(), "artifact-1", 7, nil, ArtifactVisibilityPrivate)

	require.ErrorIs(t, err, expected)
	assert.Nil(t, artifact)
}

func TestCreatePublicLinkStoresOnlyTokenHashAndMarksArtifactPublic(t *testing.T) {
	orgID := int32(13)
	var capturedHash string
	var calls []string
	svc := NewService(stubArtifactStore{
		createPublicLinkShareFunc: func(_ context.Context, input CreateArtifactPublicLinkShareInput) (ArtifactShareRecord, error) {
			calls = append(calls, "share")
			assert.Equal(t, "artifact-1", input.ArtifactID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			assert.NotEmpty(t, input.ID)
			assert.Len(t, input.TokenHash, 64)
			capturedHash = input.TokenHash
			return ArtifactShareRecord{
				ID:             input.ID,
				ArtifactID:     input.ArtifactID,
				OrganizationID: input.OrganizationID,
				Scope:          ArtifactShareScopePublicLink,
				TokenHash:      &input.TokenHash,
				Permission:     ArtifactPermissionView,
			}, nil
		},
		updateArtifactVisibilityFunc: func(_ context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			calls = append(calls, "visibility")
			assert.Equal(t, ArtifactVisibilityPublicLink, input.Visibility)
			return ArtifactRecord{
				ID:             input.ID,
				OwnerUserID:    input.OwnerUserID,
				OrganizationID: input.OrganizationID,
				Visibility:     input.Visibility,
			}, nil
		},
	})

	link, err := svc.CreatePublicLink(context.Background(), "artifact-1", 7, &orgID)

	require.NoError(t, err)
	require.NotNil(t, link)
	assert.NotEmpty(t, link.Token)
	assert.NotEqual(t, link.Token, capturedHash)
	assert.Equal(t, capturedHash, HashPublicToken(link.Token))
	assert.Equal(t, ArtifactVisibilityPublicLink, link.Artifact.Visibility)
	assert.Equal(t, []string{"visibility", "share"}, calls)
}

func TestCreatePublicLinkDoesNotCreateShareWhenVisibilityUpdateFails(t *testing.T) {
	svc := NewService(stubArtifactStore{
		createPublicLinkShareFunc: func(_ context.Context, input CreateArtifactPublicLinkShareInput) (ArtifactShareRecord, error) {
			t.Fatal("share should not be created when visibility update fails")
			return ArtifactShareRecord{}, nil
		},
		updateArtifactVisibilityFunc: func(_ context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			return ArtifactRecord{}, errors.New("visibility failed")
		},
	})

	link, err := svc.CreatePublicLink(context.Background(), "artifact-1", 7, nil)

	require.Error(t, err)
	assert.Nil(t, link)
}

func TestCreatePublicLinkReturnsTokenGenerationError(t *testing.T) {
	expected := errors.New("random failed")
	origRead := readPublicTokenRandom
	readPublicTokenRandom = func([]byte) (int, error) {
		return 0, expected
	}
	t.Cleanup(func() { readPublicTokenRandom = origRead })

	svc := NewService(stubArtifactStore{})
	link, err := svc.CreatePublicLink(context.Background(), "artifact-1", 7, nil)

	require.ErrorIs(t, err, expected)
	assert.Nil(t, link)
}

func TestCreatePublicLinkRejectsInvalidInputAndReturnsShareErrors(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	link, err := svc.CreatePublicLink(context.Background(), " ", 7, nil)
	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, link)

	expected := errors.New("share failed")
	svc = NewService(stubArtifactStore{
		updateArtifactVisibilityFunc: func(_ context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			return ArtifactRecord{ID: input.ID, OwnerUserID: input.OwnerUserID, Visibility: input.Visibility}, nil
		},
		createPublicLinkShareFunc: func(_ context.Context, _ CreateArtifactPublicLinkShareInput) (ArtifactShareRecord, error) {
			return ArtifactShareRecord{}, expected
		},
	})

	link, err = svc.CreatePublicLink(context.Background(), "artifact-1", 7, nil)
	require.ErrorIs(t, err, expected)
	assert.Nil(t, link)
}

func TestRevokePublicLinksRevokesAndMarksArtifactPrivate(t *testing.T) {
	orgID := int32(13)
	svc := NewService(stubArtifactStore{
		revokePublicLinkSharesFunc: func(_ context.Context, input RevokeArtifactPublicLinkSharesForOwnerInput) error {
			assert.Equal(t, "artifact-1", input.ArtifactID)
			assert.Equal(t, int32(7), input.OwnerUserID)
			assert.Equal(t, &orgID, input.OrganizationID)
			return nil
		},
		updateArtifactVisibilityFunc: func(_ context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			assert.Equal(t, ArtifactVisibilityPrivate, input.Visibility)
			return ArtifactRecord{ID: input.ID, Visibility: input.Visibility}, nil
		},
	})

	err := svc.RevokePublicLinks(context.Background(), "artifact-1", 7, &orgID)

	require.NoError(t, err)
}

func TestRevokePublicLinksRejectsInvalidInputAndPropagatesStoreErrors(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	err := svc.RevokePublicLinks(context.Background(), "artifact-1", 0, nil)
	require.ErrorIs(t, err, ErrInvalidArtifactInput)

	expected := errors.New("revoke failed")
	svc = NewService(stubArtifactStore{
		revokePublicLinkSharesFunc: func(_ context.Context, _ RevokeArtifactPublicLinkSharesForOwnerInput) error {
			return expected
		},
	})

	err = svc.RevokePublicLinks(context.Background(), "artifact-1", 7, nil)
	require.ErrorIs(t, err, expected)

	svc = NewService(stubArtifactStore{
		revokePublicLinkSharesFunc: func(_ context.Context, _ RevokeArtifactPublicLinkSharesForOwnerInput) error {
			return nil
		},
		updateArtifactVisibilityFunc: func(_ context.Context, _ UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error) {
			return ArtifactRecord{}, expected
		},
	})

	err = svc.RevokePublicLinks(context.Background(), "artifact-1", 7, nil)
	require.ErrorIs(t, err, expected)
}

func TestGetPublicArtifactHashesTokenBeforeLookup(t *testing.T) {
	svc := NewService(stubArtifactStore{
		getPublicArtifactFunc: func(_ context.Context, tokenHash string) (PublicArtifactRecord, error) {
			assert.Equal(t, HashPublicToken("public-token"), tokenHash)
			return PublicArtifactRecord{
				Artifact: ArtifactRecord{ID: "artifact-1", Visibility: ArtifactVisibilityPublicLink},
				Version:  ArtifactVersionRecord{ID: "version-1", ArtifactID: "artifact-1", Version: 1},
				Share:    ArtifactShareRecord{ID: "share-1", ArtifactID: "artifact-1", Scope: ArtifactShareScopePublicLink},
			}, nil
		},
	})

	artifact, err := svc.GetPublicArtifact(context.Background(), " public-token ")

	require.NoError(t, err)
	require.NotNil(t, artifact)
	assert.Equal(t, "artifact-1", artifact.Artifact.ID)
	assert.Equal(t, "version-1", artifact.Version.ID)
	assert.Equal(t, "public-token", artifact.Token)
}

func TestGetPublicArtifactRejectsInvalidInputAndReturnsStoreError(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	artifact, err := svc.GetPublicArtifact(context.Background(), " ")
	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, artifact)

	expected := errors.New("lookup failed")
	svc = NewService(stubArtifactStore{
		getPublicArtifactFunc: func(_ context.Context, _ string) (PublicArtifactRecord, error) {
			return PublicArtifactRecord{}, expected
		},
	})

	artifact, err = svc.GetPublicArtifact(context.Background(), "token")
	require.ErrorIs(t, err, expected)
	assert.Nil(t, artifact)
}

func TestGetPublicArtifactFileHashesTokenBeforeLookup(t *testing.T) {
	svc := NewService(stubArtifactStore{
		getPublicArtifactFileFunc: func(_ context.Context, tokenHash string) (PublicArtifactFileRecord, error) {
			assert.Equal(t, HashPublicToken("public-token"), tokenHash)
			return PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   7,
				Filename: "review.html",
				MimeType: "text/html",
				BlobURL:  "https://blob.example/review.html",
			}, nil
		},
	})

	file, err := svc.GetPublicArtifactFile(context.Background(), " public-token ")

	require.NoError(t, err)
	require.NotNil(t, file)
	assert.Equal(t, "file-1", file.ID)
}

func TestGetPublicArtifactFileRejectsInvalidInputAndReturnsStoreError(t *testing.T) {
	svc := NewService(stubArtifactStore{})

	file, err := svc.GetPublicArtifactFile(context.Background(), " ")
	require.ErrorIs(t, err, ErrInvalidArtifactInput)
	assert.Nil(t, file)

	expected := errors.New("file lookup failed")
	svc = NewService(stubArtifactStore{
		getPublicArtifactFileFunc: func(_ context.Context, _ string) (PublicArtifactFileRecord, error) {
			return PublicArtifactFileRecord{}, expected
		},
	})

	file, err = svc.GetPublicArtifactFile(context.Background(), "token")
	require.ErrorIs(t, err, expected)
	assert.Nil(t, file)
}
