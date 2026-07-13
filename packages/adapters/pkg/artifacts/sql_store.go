package artifacts

import (
	"context"
	"errors"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var _ coreartifacts.ArtifactStore = (*SQLStore)(nil)

type SQLStore struct {
	q *db.Queries
}

func NewSQLStore(q *db.Queries) *SQLStore {
	return &SQLStore{q: q}
}

const getCurrentArtifactVersionsForUser = `
SELECT av.id, av.artifact_id, av.version, av.file_id, av.mime_type, av.filename, av.bytes, av.render_metadata, av.source_tool_name, av.source_prompt, av.created_by_user_id, av.created_at
FROM artifacts AS a
JOIN artifact_versions AS av ON a.current_version_id = av.id
WHERE
	a.id = ANY($1::text[])
	AND (
		(
			a.owner_user_id = $2
			AND (
				($3::INT IS NULL AND a.organization_id IS NULL)
				OR a.organization_id = $3::INT
			)
		)
		OR (
			$3::INT IS NOT NULL
			AND a.organization_id = $3::INT
			AND a.visibility = 'ORGANIZATION'::"ArtifactVisibility"
		)
	)
	AND a.deleted_at IS NULL
`

func (s *SQLStore) CreateArtifact(ctx context.Context, input coreartifacts.CreateArtifactStoreInput) (coreartifacts.ArtifactRecord, error) {
	artifact, err := s.q.CreateArtifact(ctx, db.CreateArtifactParams{
		ID:             input.ID,
		OrganizationID: input.OrganizationID,
		OwnerUserID:    input.OwnerUserID,
		ConversationID: input.ConversationID,
		MessageID:      input.MessageID,
		TaskID:         input.TaskID,
		Type:           db.ArtifactType(input.Type),
		Title:          input.Title,
		Status:         db.ArtifactStatus(input.Status),
		Visibility:     db.ArtifactVisibility(input.Visibility),
		Metadata:       input.Metadata,
	})
	if err != nil {
		return coreartifacts.ArtifactRecord{}, mapArtifactStoreError(err)
	}
	return artifactRecord(artifact), nil
}

func (s *SQLStore) CreateArtifactVersion(ctx context.Context, input coreartifacts.CreateArtifactVersionStoreInput) (coreartifacts.ArtifactVersionRecord, error) {
	version, err := s.q.CreateArtifactVersion(ctx, db.CreateArtifactVersionParams{
		ID:              input.ID,
		ArtifactID:      input.ArtifactID,
		Version:         input.Version,
		FileID:          input.FileID,
		MimeType:        input.MimeType,
		Filename:        input.Filename,
		Bytes:           input.Bytes,
		RenderMetadata:  input.RenderMetadata,
		SourceToolName:  input.SourceToolName,
		SourcePrompt:    input.SourcePrompt,
		CreatedByUserID: input.CreatedByUserID,
	})
	if err != nil {
		return coreartifacts.ArtifactVersionRecord{}, err
	}
	return artifactVersionRecord(version), nil
}

func (s *SQLStore) SetArtifactCurrentVersion(ctx context.Context, input coreartifacts.SetArtifactCurrentVersionInput) (coreartifacts.ArtifactRecord, error) {
	artifact, err := s.q.SetArtifactCurrentVersion(ctx, db.SetArtifactCurrentVersionParams{
		ID:               input.ID,
		CurrentVersionID: &input.CurrentVersionID,
		OwnerUserID:      input.OwnerUserID,
		OrganizationID:   input.OrganizationID,
	})
	if err != nil {
		return coreartifacts.ArtifactRecord{}, mapArtifactStoreError(err)
	}
	return artifactRecord(artifact), nil
}

func (s *SQLStore) GetArtifactByIDForUser(ctx context.Context, input coreartifacts.GetArtifactByIDForUserInput) (coreartifacts.ArtifactRecord, error) {
	artifact, err := s.q.GetArtifactByIDForUser(ctx, db.GetArtifactByIDForUserParams{
		ID:             input.ID,
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return coreartifacts.ArtifactRecord{}, mapArtifactStoreError(err)
	}
	return artifactRecord(artifact), nil
}

func (s *SQLStore) ListArtifactsForUser(ctx context.Context, input coreartifacts.ListArtifactsForUserInput) ([]coreartifacts.ArtifactRecord, error) {
	artifacts, err := s.q.ListArtifactsForUser(ctx, db.ListArtifactsForUserParams{
		OwnerUserID: input.OwnerUserID,
		Limit:       input.Limit,
		Offset:      input.Offset,
	})
	if err != nil {
		return nil, err
	}
	return artifactRecords(artifacts), nil
}

func (s *SQLStore) ListArtifactsForUserAndOrg(ctx context.Context, input coreartifacts.ListArtifactsForUserAndOrgInput) ([]coreartifacts.ArtifactRecord, error) {
	artifacts, err := s.q.ListArtifactsForUserAndOrg(ctx, db.ListArtifactsForUserAndOrgParams{
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
		Limit:          input.Limit,
		Offset:         input.Offset,
	})
	if err != nil {
		return nil, err
	}
	return artifactRecords(artifacts), nil
}

func (s *SQLStore) GetArtifactVersionsForUser(ctx context.Context, input coreartifacts.GetArtifactVersionsForUserInput) ([]coreartifacts.ArtifactVersionRecord, error) {
	versions, err := s.q.GetArtifactVersionsForUser(ctx, db.GetArtifactVersionsForUserParams{
		ArtifactID:     input.ArtifactID,
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	return artifactVersionRecords(versions), nil
}

func (s *SQLStore) GetCurrentArtifactVersionsForUser(ctx context.Context, input coreartifacts.GetCurrentArtifactVersionsForUserInput) ([]coreartifacts.ArtifactVersionRecord, error) {
	rows, err := s.q.GetDB().Query(ctx, getCurrentArtifactVersionsForUser, input.ArtifactIDs, input.OwnerUserID, input.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	versions, err := scanArtifactVersionRows(rows)
	if err != nil {
		return nil, err
	}
	return artifactVersionRecords(versions), nil
}

func (s *SQLStore) UpdateArtifactVisibilityForOwner(ctx context.Context, input coreartifacts.UpdateArtifactVisibilityForOwnerInput) (coreartifacts.ArtifactRecord, error) {
	artifact, err := s.q.UpdateArtifactVisibilityForOwner(ctx, db.UpdateArtifactVisibilityForOwnerParams{
		ID:             input.ID,
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
		Visibility:     db.ArtifactVisibility(input.Visibility),
	})
	if err != nil {
		return coreartifacts.ArtifactRecord{}, mapArtifactStoreError(err)
	}
	return artifactRecord(artifact), nil
}

func (s *SQLStore) CreateArtifactPublicLinkShare(ctx context.Context, input coreartifacts.CreateArtifactPublicLinkShareInput) (coreartifacts.ArtifactShareRecord, error) {
	share, err := s.q.CreateArtifactPublicLinkShare(ctx, db.CreateArtifactPublicLinkShareParams{
		ID:             input.ID,
		ArtifactID:     input.ArtifactID,
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
		TokenHash:      &input.TokenHash,
	})
	if err != nil {
		return coreartifacts.ArtifactShareRecord{}, mapArtifactStoreError(err)
	}
	return artifactShareRecord(share), nil
}

func (s *SQLStore) RevokeArtifactPublicLinkSharesForOwner(ctx context.Context, input coreartifacts.RevokeArtifactPublicLinkSharesForOwnerInput) error {
	return s.q.RevokeArtifactPublicLinkSharesForOwner(ctx, db.RevokeArtifactPublicLinkSharesForOwnerParams{
		ArtifactID:     input.ArtifactID,
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
	})
}

func (s *SQLStore) GetPublicArtifactByTokenHash(ctx context.Context, tokenHash string) (coreartifacts.PublicArtifactRecord, error) {
	row, err := s.q.GetPublicArtifactByTokenHash(ctx, &tokenHash)
	if err != nil {
		return coreartifacts.PublicArtifactRecord{}, mapArtifactStoreError(err)
	}
	return coreartifacts.PublicArtifactRecord{
		Artifact: artifactRecord(row.Artifact),
		Version:  artifactVersionRecord(row.ArtifactVersion),
		Share:    artifactShareRecord(row.ArtifactShare),
	}, nil
}

func (s *SQLStore) GetPublicArtifactFileByTokenHash(ctx context.Context, tokenHash string) (coreartifacts.PublicArtifactFileRecord, error) {
	file, err := s.q.GetPublicArtifactFileByTokenHash(ctx, &tokenHash)
	if err != nil {
		return coreartifacts.PublicArtifactFileRecord{}, mapArtifactStoreError(err)
	}
	return coreartifacts.PublicArtifactFileRecord{
		ID:        file.ID,
		UserID:    file.UserID,
		Filename:  file.Filename,
		MimeType:  file.MimeType,
		Bytes:     file.Bytes,
		BlobURL:   file.BlobUrl,
		BlobPath:  file.BlobPath,
		CreatedAt: file.CreatedAt.Time,
	}, nil
}

func (s *SQLStore) SoftDeleteArtifactForUser(ctx context.Context, input coreartifacts.SoftDeleteArtifactForUserInput) (coreartifacts.ArtifactRecord, error) {
	artifact, err := s.q.SoftDeleteArtifactForUser(ctx, db.SoftDeleteArtifactForUserParams{
		ID:             input.ID,
		OwnerUserID:    input.OwnerUserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return coreartifacts.ArtifactRecord{}, mapArtifactStoreError(err)
	}
	return artifactRecord(artifact), nil
}

func (s *SQLStore) SoftDeleteArtifactFilesForUser(ctx context.Context, input coreartifacts.SoftDeleteArtifactFilesForUserInput) error {
	return s.q.SoftDeleteDeveloperFilesByIDsForUser(ctx, input.FileIDs, input.OwnerUserID, input.OrganizationID)
}

func mapArtifactStoreError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return coreartifacts.ErrArtifactNotFound
	}
	return err
}

func artifactRecords(artifacts []db.Artifact) []coreartifacts.ArtifactRecord {
	records := make([]coreartifacts.ArtifactRecord, len(artifacts))
	for i, artifact := range artifacts {
		records[i] = artifactRecord(artifact)
	}
	return records
}

func artifactRecord(artifact db.Artifact) coreartifacts.ArtifactRecord {
	return coreartifacts.ArtifactRecord{
		ID:               artifact.ID,
		OrganizationID:   artifact.OrganizationID,
		OwnerUserID:      artifact.OwnerUserID,
		ConversationID:   artifact.ConversationID,
		MessageID:        artifact.MessageID,
		TaskID:           artifact.TaskID,
		Type:             coreartifacts.ArtifactType(artifact.Type),
		Title:            artifact.Title,
		Status:           coreartifacts.ArtifactStatus(artifact.Status),
		Visibility:       coreartifacts.ArtifactVisibility(artifact.Visibility),
		CurrentVersionID: artifact.CurrentVersionID,
		Metadata:         artifact.Metadata,
		CreatedAt:        artifact.CreatedAt.Time,
		UpdatedAt:        artifact.UpdatedAt.Time,
		DeletedAt:        timestampPtr(artifact.DeletedAt),
	}
}

func artifactVersionRecords(versions []db.ArtifactVersion) []coreartifacts.ArtifactVersionRecord {
	records := make([]coreartifacts.ArtifactVersionRecord, len(versions))
	for i, version := range versions {
		records[i] = artifactVersionRecord(version)
	}
	return records
}

func scanArtifactVersionRows(rows pgx.Rows) ([]db.ArtifactVersion, error) {
	versions := []db.ArtifactVersion{}
	for rows.Next() {
		var version db.ArtifactVersion
		if err := rows.Scan(
			&version.ID,
			&version.ArtifactID,
			&version.Version,
			&version.FileID,
			&version.MimeType,
			&version.Filename,
			&version.Bytes,
			&version.RenderMetadata,
			&version.SourceToolName,
			&version.SourcePrompt,
			&version.CreatedByUserID,
			&version.CreatedAt,
		); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return versions, nil
}

func artifactVersionRecord(version db.ArtifactVersion) coreartifacts.ArtifactVersionRecord {
	return coreartifacts.ArtifactVersionRecord{
		ID:              version.ID,
		ArtifactID:      version.ArtifactID,
		Version:         version.Version,
		FileID:          version.FileID,
		MimeType:        version.MimeType,
		Filename:        version.Filename,
		Bytes:           version.Bytes,
		RenderMetadata:  version.RenderMetadata,
		SourceToolName:  version.SourceToolName,
		SourcePrompt:    version.SourcePrompt,
		CreatedByUserID: version.CreatedByUserID,
		CreatedAt:       version.CreatedAt.Time,
	}
}

func artifactShareRecord(share db.ArtifactShare) coreartifacts.ArtifactShareRecord {
	return coreartifacts.ArtifactShareRecord{
		ID:             share.ID,
		ArtifactID:     share.ArtifactID,
		OrganizationID: share.OrganizationID,
		Scope:          coreartifacts.ArtifactShareScope(share.Scope),
		TargetUserID:   share.TargetUserID,
		TokenHash:      share.TokenHash,
		Permission:     coreartifacts.ArtifactPermission(share.Permission),
		ExpiresAt:      timestampPtr(share.ExpiresAt),
		CreatedAt:      share.CreatedAt.Time,
		RevokedAt:      timestampPtr(share.RevokedAt),
	}
}

func timestampPtr(timestamp pgtype.Timestamp) *time.Time {
	if !timestamp.Valid {
		return nil
	}
	value := timestamp.Time
	return &value
}
