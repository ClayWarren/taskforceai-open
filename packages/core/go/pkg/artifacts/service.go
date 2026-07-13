package artifacts

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ArtifactType string

const (
	ArtifactTypeDocument    ArtifactType = "DOCUMENT"
	ArtifactTypeSpreadsheet ArtifactType = "SPREADSHEET"
	ArtifactTypeChart       ArtifactType = "CHART"
	ArtifactTypeImage       ArtifactType = "IMAGE"
	ArtifactTypeVideo       ArtifactType = "VIDEO"
	ArtifactTypeSite        ArtifactType = "SITE"
	ArtifactTypeDashboard   ArtifactType = "DASHBOARD"
	ArtifactTypeArchive     ArtifactType = "ARCHIVE"
	ArtifactTypeOther       ArtifactType = "OTHER"
)

type ArtifactStatus string

const (
	ArtifactStatusProcessing ArtifactStatus = "PROCESSING"
	ArtifactStatusReady      ArtifactStatus = "READY"
	ArtifactStatusFailed     ArtifactStatus = "FAILED"
	ArtifactStatusDeleted    ArtifactStatus = "DELETED"
)

type ArtifactVisibility string

const (
	ArtifactVisibilityPrivate      ArtifactVisibility = "PRIVATE"
	ArtifactVisibilityOrganization ArtifactVisibility = "ORGANIZATION"
	ArtifactVisibilityPublicLink   ArtifactVisibility = "PUBLIC_LINK"
)

var (
	ErrInvalidArtifactInput = errors.New("invalid artifact input")
	ErrArtifactNotFound     = errors.New("artifact not found")
)

type Artifact struct {
	ID               string
	OrganizationID   *int32
	OwnerUserID      int32
	ConversationID   *int32
	MessageID        *string
	TaskID           *string
	Type             ArtifactType
	Title            string
	Status           ArtifactStatus
	Visibility       ArtifactVisibility
	CurrentVersionID *string
	Metadata         []byte
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
}

type ArtifactVersion struct {
	ID              string
	ArtifactID      string
	Version         int32
	FileID          *string
	MimeType        *string
	Filename        *string
	Bytes           *int64
	RenderMetadata  []byte
	SourceToolName  *string
	SourcePrompt    *string
	CreatedByUserID *int32
	CreatedAt       time.Time
}

type ArtifactShareScope string

const (
	ArtifactShareScopeOrganization ArtifactShareScope = "ORGANIZATION"
	ArtifactShareScopePublicLink   ArtifactShareScope = "PUBLIC_LINK"
	ArtifactShareScopeUser         ArtifactShareScope = "USER"
)

type ArtifactPermission string

const (
	ArtifactPermissionView    ArtifactPermission = "VIEW"
	ArtifactPermissionComment ArtifactPermission = "COMMENT"
	ArtifactPermissionEdit    ArtifactPermission = "EDIT"
)

type ArtifactShare struct {
	ID             string
	ArtifactID     string
	OrganizationID *int32
	Scope          ArtifactShareScope
	TargetUserID   *int32
	TokenHash      *string
	Permission     ArtifactPermission
	ExpiresAt      *time.Time
	CreatedAt      time.Time
	RevokedAt      *time.Time
}

type CreateArtifactInput struct {
	OrganizationID  *int32
	OwnerUserID     int32
	ConversationID  *int32
	MessageID       *string
	TaskID          *string
	Type            ArtifactType
	Title           string
	Visibility      ArtifactVisibility
	Metadata        []byte
	FileID          *string
	MimeType        *string
	Filename        *string
	Bytes           *int64
	RenderMetadata  []byte
	SourceToolName  *string
	SourcePrompt    *string
	CreatedByUserID *int32
}

type ArtifactWithVersion struct {
	Artifact Artifact
	Version  ArtifactVersion
}

type PublicArtifact struct {
	Artifact Artifact
	Version  ArtifactVersion
	Share    ArtifactShare
	Token    string
}

type PublicLink struct {
	Token    string
	Artifact Artifact
	Share    ArtifactShare
}

type ArtifactStore interface {
	CreateArtifact(ctx context.Context, input CreateArtifactStoreInput) (ArtifactRecord, error)
	CreateArtifactVersion(ctx context.Context, input CreateArtifactVersionStoreInput) (ArtifactVersionRecord, error)
	SetArtifactCurrentVersion(ctx context.Context, input SetArtifactCurrentVersionInput) (ArtifactRecord, error)
	GetArtifactByIDForUser(ctx context.Context, input GetArtifactByIDForUserInput) (ArtifactRecord, error)
	ListArtifactsForUser(ctx context.Context, input ListArtifactsForUserInput) ([]ArtifactRecord, error)
	ListArtifactsForUserAndOrg(ctx context.Context, input ListArtifactsForUserAndOrgInput) ([]ArtifactRecord, error)
	GetArtifactVersionsForUser(ctx context.Context, input GetArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error)
	UpdateArtifactVisibilityForOwner(ctx context.Context, input UpdateArtifactVisibilityForOwnerInput) (ArtifactRecord, error)
	CreateArtifactPublicLinkShare(ctx context.Context, input CreateArtifactPublicLinkShareInput) (ArtifactShareRecord, error)
	RevokeArtifactPublicLinkSharesForOwner(ctx context.Context, input RevokeArtifactPublicLinkSharesForOwnerInput) error
	GetPublicArtifactByTokenHash(ctx context.Context, tokenHash string) (PublicArtifactRecord, error)
	GetPublicArtifactFileByTokenHash(ctx context.Context, tokenHash string) (PublicArtifactFileRecord, error)
	SoftDeleteArtifactForUser(ctx context.Context, input SoftDeleteArtifactForUserInput) (ArtifactRecord, error)
	SoftDeleteArtifactFilesForUser(ctx context.Context, input SoftDeleteArtifactFilesForUserInput) error
}

type artifactCurrentVersionStore interface {
	GetCurrentArtifactVersionsForUser(ctx context.Context, input GetCurrentArtifactVersionsForUserInput) ([]ArtifactVersionRecord, error)
}

type CreateArtifactStoreInput struct {
	ID             string
	OrganizationID *int32
	OwnerUserID    int32
	ConversationID *int32
	MessageID      *string
	TaskID         *string
	Type           ArtifactType
	Title          string
	Status         ArtifactStatus
	Visibility     ArtifactVisibility
	Metadata       []byte
}

type CreateArtifactVersionStoreInput struct {
	ID              string
	ArtifactID      string
	Version         int32
	FileID          *string
	MimeType        *string
	Filename        *string
	Bytes           *int64
	RenderMetadata  []byte
	SourceToolName  *string
	SourcePrompt    *string
	CreatedByUserID *int32
}

type SetArtifactCurrentVersionInput struct {
	ID               string
	CurrentVersionID string
	OwnerUserID      int32
	OrganizationID   *int32
}

type GetArtifactByIDForUserInput struct {
	ID             string
	OwnerUserID    int32
	OrganizationID *int32
}

type ListArtifactsForUserInput struct {
	OwnerUserID int32
	Limit       int32
	Offset      int32
}

type ListArtifactsForUserAndOrgInput struct {
	OwnerUserID    int32
	OrganizationID *int32
	Limit          int32
	Offset         int32
}

type GetArtifactVersionsForUserInput struct {
	ArtifactID     string
	OwnerUserID    int32
	OrganizationID *int32
}

type GetCurrentArtifactVersionsForUserInput struct {
	ArtifactIDs    []string
	OwnerUserID    int32
	OrganizationID *int32
}

type SoftDeleteArtifactForUserInput struct {
	ID             string
	OwnerUserID    int32
	OrganizationID *int32
}

type SoftDeleteArtifactFilesForUserInput struct {
	FileIDs        []string
	OwnerUserID    int32
	OrganizationID *int32
}

type UpdateArtifactVisibilityForOwnerInput struct {
	ID             string
	OwnerUserID    int32
	OrganizationID *int32
	Visibility     ArtifactVisibility
}

type CreateArtifactPublicLinkShareInput struct {
	ID             string
	ArtifactID     string
	OwnerUserID    int32
	OrganizationID *int32
	TokenHash      string
}

type RevokeArtifactPublicLinkSharesForOwnerInput struct {
	ArtifactID     string
	OwnerUserID    int32
	OrganizationID *int32
}

type PublicArtifactRecord struct {
	Artifact ArtifactRecord
	Version  ArtifactVersionRecord
	Share    ArtifactShareRecord
}

type PublicArtifactFileRecord struct {
	ID        string
	UserID    int32
	Filename  string
	MimeType  string
	Bytes     int64
	BlobURL   string
	BlobPath  string
	CreatedAt time.Time
}

type ArtifactRecord Artifact

type ArtifactVersionRecord ArtifactVersion

type ArtifactShareRecord ArtifactShare

type Service struct {
	store ArtifactStore
}

func NewService(store ArtifactStore) *Service {
	return &Service{store: store}
}

func (s *Service) CreateArtifactWithInitialVersion(ctx context.Context, input CreateArtifactInput) (*ArtifactWithVersion, error) {
	if input.OwnerUserID <= 0 || strings.TrimSpace(input.Title) == "" {
		return nil, ErrInvalidArtifactInput
	}

	artifactType := input.Type
	if artifactType == "" {
		artifactType = ArtifactTypeOther
	}
	visibility := input.Visibility
	if visibility == "" {
		visibility = ArtifactVisibilityPrivate
	}

	artifactID := uuid.NewString()
	artifact, err := s.store.CreateArtifact(ctx, CreateArtifactStoreInput{
		ID:             artifactID,
		OrganizationID: input.OrganizationID,
		OwnerUserID:    input.OwnerUserID,
		ConversationID: input.ConversationID,
		MessageID:      input.MessageID,
		TaskID:         input.TaskID,
		Type:           artifactType,
		Title:          strings.TrimSpace(input.Title),
		Status:         ArtifactStatusReady,
		Visibility:     visibility,
		Metadata:       input.Metadata,
	})
	if err != nil {
		return nil, err
	}

	version, err := s.store.CreateArtifactVersion(ctx, CreateArtifactVersionStoreInput{
		ID:              uuid.NewString(),
		ArtifactID:      artifact.ID,
		Version:         1,
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
		return nil, err
	}

	artifact, err = s.store.SetArtifactCurrentVersion(ctx, SetArtifactCurrentVersionInput{
		ID:               artifact.ID,
		CurrentVersionID: version.ID,
		OwnerUserID:      input.OwnerUserID,
		OrganizationID:   input.OrganizationID,
	})
	if err != nil {
		return nil, err
	}

	return &ArtifactWithVersion{
		Artifact: Artifact(artifact),
		Version:  ArtifactVersion(version),
	}, nil
}

func (s *Service) ListArtifacts(ctx context.Context, ownerUserID int32, organizationID *int32, limit, offset int32) ([]Artifact, error) {
	if ownerUserID <= 0 {
		return nil, ErrInvalidArtifactInput
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	var rows []ArtifactRecord
	var err error
	if organizationID != nil {
		rows, err = s.store.ListArtifactsForUserAndOrg(ctx, ListArtifactsForUserAndOrgInput{
			OwnerUserID:    ownerUserID,
			OrganizationID: organizationID,
			Limit:          limit,
			Offset:         offset,
		})
	} else {
		rows, err = s.store.ListArtifactsForUser(ctx, ListArtifactsForUserInput{
			OwnerUserID: ownerUserID,
			Limit:       limit,
			Offset:      offset,
		})
	}
	if err != nil {
		return nil, err
	}

	artifacts := make([]Artifact, len(rows))
	for i, row := range rows {
		artifacts[i] = Artifact(row)
	}
	return artifacts, nil
}

func (s *Service) GetArtifact(ctx context.Context, id string, ownerUserID int32, organizationID *int32) (*Artifact, error) {
	if strings.TrimSpace(id) == "" || ownerUserID <= 0 {
		return nil, ErrInvalidArtifactInput
	}
	row, err := s.store.GetArtifactByIDForUser(ctx, GetArtifactByIDForUserInput{
		ID:             id,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
	})
	if err != nil {
		return nil, err
	}
	artifact := Artifact(row)
	return &artifact, nil
}

func (s *Service) GetArtifactVersions(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) ([]ArtifactVersion, error) {
	if strings.TrimSpace(artifactID) == "" || ownerUserID <= 0 {
		return nil, ErrInvalidArtifactInput
	}
	rows, err := s.store.GetArtifactVersionsForUser(ctx, GetArtifactVersionsForUserInput{
		ArtifactID:     artifactID,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
	})
	if err != nil {
		return nil, err
	}
	versions := make([]ArtifactVersion, len(rows))
	for i, row := range rows {
		versions[i] = ArtifactVersion(row)
	}
	return versions, nil
}

func (s *Service) GetArtifactCurrentVersions(ctx context.Context, artifactIDs []string, ownerUserID int32, organizationID *int32) (map[string]ArtifactVersion, error) {
	if ownerUserID <= 0 {
		return nil, ErrInvalidArtifactInput
	}
	cleanIDs := cleanArtifactIDs(artifactIDs)
	if len(cleanIDs) == 0 {
		return map[string]ArtifactVersion{}, nil
	}

	if store, ok := s.store.(artifactCurrentVersionStore); ok {
		rows, err := store.GetCurrentArtifactVersionsForUser(ctx, GetCurrentArtifactVersionsForUserInput{
			ArtifactIDs:    cleanIDs,
			OwnerUserID:    ownerUserID,
			OrganizationID: organizationID,
		})
		if err != nil {
			return nil, err
		}
		return artifactVersionMap(rows), nil
	}

	versionsByArtifactID := make(map[string]ArtifactVersion, len(cleanIDs))
	for _, artifactID := range cleanIDs {
		versions, err := s.GetArtifactVersions(ctx, artifactID, ownerUserID, organizationID)
		if err != nil {
			return nil, err
		}
		if len(versions) > 0 {
			versionsByArtifactID[artifactID] = versions[0]
		}
	}
	return versionsByArtifactID, nil
}

func (s *Service) DeleteArtifact(ctx context.Context, id string, ownerUserID int32, organizationID *int32) error {
	if strings.TrimSpace(id) == "" || ownerUserID <= 0 {
		return ErrInvalidArtifactInput
	}
	versions, err := s.store.GetArtifactVersionsForUser(ctx, GetArtifactVersionsForUserInput{
		ArtifactID:     id,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
	})
	if err != nil {
		return err
	}
	_, err = s.store.SoftDeleteArtifactForUser(ctx, SoftDeleteArtifactForUserInput{
		ID:             id,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
	})
	if err != nil {
		return err
	}
	fileIDs := artifactVersionFileIDs(versions)
	if len(fileIDs) == 0 {
		return nil
	}
	return s.store.SoftDeleteArtifactFilesForUser(ctx, SoftDeleteArtifactFilesForUserInput{
		FileIDs:        fileIDs,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
	})
}

func cleanArtifactIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	clean := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		clean = append(clean, id)
	}
	return clean
}

func artifactVersionMap(rows []ArtifactVersionRecord) map[string]ArtifactVersion {
	versionsByArtifactID := make(map[string]ArtifactVersion, len(rows))
	for _, row := range rows {
		versionsByArtifactID[row.ArtifactID] = ArtifactVersion(row)
	}
	return versionsByArtifactID
}

func artifactVersionFileIDs(versions []ArtifactVersionRecord) []string {
	seen := map[string]struct{}{}
	fileIDs := make([]string, 0, len(versions))
	for _, version := range versions {
		if version.FileID == nil || strings.TrimSpace(*version.FileID) == "" {
			continue
		}
		if _, ok := seen[*version.FileID]; ok {
			continue
		}
		seen[*version.FileID] = struct{}{}
		fileIDs = append(fileIDs, *version.FileID)
	}
	return fileIDs
}

func (s *Service) UpdateArtifactVisibility(ctx context.Context, id string, ownerUserID int32, organizationID *int32, visibility ArtifactVisibility) (*Artifact, error) {
	if strings.TrimSpace(id) == "" || ownerUserID <= 0 || !userSettableVisibility(visibility) {
		return nil, ErrInvalidArtifactInput
	}
	if visibility == ArtifactVisibilityOrganization && organizationID == nil {
		return nil, ErrInvalidArtifactInput
	}
	row, err := s.setArtifactVisibility(ctx, id, ownerUserID, organizationID, visibility)
	if err != nil {
		return nil, err
	}
	artifact := Artifact(row)
	return &artifact, nil
}

func (s *Service) CreatePublicLink(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) (*PublicLink, error) {
	if strings.TrimSpace(artifactID) == "" || ownerUserID <= 0 {
		return nil, ErrInvalidArtifactInput
	}
	token, err := generatePublicToken()
	if err != nil {
		return nil, err
	}
	artifact, err := s.setArtifactVisibility(ctx, artifactID, ownerUserID, organizationID, ArtifactVisibilityPublicLink)
	if err != nil {
		return nil, err
	}
	share, err := s.store.CreateArtifactPublicLinkShare(ctx, CreateArtifactPublicLinkShareInput{
		ID:             uuid.NewString(),
		ArtifactID:     artifactID,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
		TokenHash:      HashPublicToken(token),
	})
	if err != nil {
		return nil, err
	}
	return &PublicLink{
		Token:    token,
		Artifact: Artifact(artifact),
		Share:    ArtifactShare(share),
	}, nil
}

func (s *Service) RevokePublicLinks(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) error {
	if strings.TrimSpace(artifactID) == "" || ownerUserID <= 0 {
		return ErrInvalidArtifactInput
	}
	if err := s.store.RevokeArtifactPublicLinkSharesForOwner(ctx, RevokeArtifactPublicLinkSharesForOwnerInput{
		ArtifactID:     artifactID,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
	}); err != nil {
		return err
	}
	_, err := s.setArtifactVisibility(ctx, artifactID, ownerUserID, organizationID, ArtifactVisibilityPrivate)
	return err
}

func (s *Service) setArtifactVisibility(ctx context.Context, id string, ownerUserID int32, organizationID *int32, visibility ArtifactVisibility) (ArtifactRecord, error) {
	return s.store.UpdateArtifactVisibilityForOwner(ctx, UpdateArtifactVisibilityForOwnerInput{
		ID:             id,
		OwnerUserID:    ownerUserID,
		OrganizationID: organizationID,
		Visibility:     visibility,
	})
}

func (s *Service) GetPublicArtifact(ctx context.Context, token string) (*PublicArtifact, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrInvalidArtifactInput
	}
	row, err := s.store.GetPublicArtifactByTokenHash(ctx, HashPublicToken(token))
	if err != nil {
		return nil, err
	}
	return &PublicArtifact{
		Artifact: Artifact(row.Artifact),
		Version:  ArtifactVersion(row.Version),
		Share:    ArtifactShare(row.Share),
		Token:    token,
	}, nil
}

func (s *Service) GetPublicArtifactFile(ctx context.Context, token string) (*PublicArtifactFileRecord, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrInvalidArtifactInput
	}
	file, err := s.store.GetPublicArtifactFileByTokenHash(ctx, HashPublicToken(token))
	if err != nil {
		return nil, err
	}
	return &file, nil
}

func userSettableVisibility(visibility ArtifactVisibility) bool {
	return visibility == ArtifactVisibilityPrivate || visibility == ArtifactVisibilityOrganization
}

func generatePublicToken() (string, error) {
	var raw [32]byte
	if _, err := readPublicTokenRandom(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func HashPublicToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

var readPublicTokenRandom = rand.Read
