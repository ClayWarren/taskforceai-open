package artifacts

import coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"

type (
	ArtifactStore  = coreartifacts.ArtifactStore
	ArtifactType   = coreartifacts.ArtifactType
	ArtifactStatus = coreartifacts.ArtifactStatus

	ArtifactVisibility = coreartifacts.ArtifactVisibility
	ArtifactShareScope = coreartifacts.ArtifactShareScope
	ArtifactPermission = coreartifacts.ArtifactPermission

	ArtifactRecord              = coreartifacts.ArtifactRecord
	ArtifactVersionRecord       = coreartifacts.ArtifactVersionRecord
	ArtifactShareRecord         = coreartifacts.ArtifactShareRecord
	PublicArtifactRecord        = coreartifacts.PublicArtifactRecord
	PublicArtifactFileRecord    = coreartifacts.PublicArtifactFileRecord
	CreateArtifactStoreInput    = coreartifacts.CreateArtifactStoreInput
	GetArtifactByIDForUserInput = coreartifacts.GetArtifactByIDForUserInput

	CreateArtifactVersionStoreInput             = coreartifacts.CreateArtifactVersionStoreInput
	SetArtifactCurrentVersionInput              = coreartifacts.SetArtifactCurrentVersionInput
	ListArtifactsForUserInput                   = coreartifacts.ListArtifactsForUserInput
	ListArtifactsForUserAndOrgInput             = coreartifacts.ListArtifactsForUserAndOrgInput
	GetArtifactVersionsForUserInput             = coreartifacts.GetArtifactVersionsForUserInput
	GetCurrentArtifactVersionsForUserInput      = coreartifacts.GetCurrentArtifactVersionsForUserInput
	SoftDeleteArtifactForUserInput              = coreartifacts.SoftDeleteArtifactForUserInput
	SoftDeleteArtifactFilesForUserInput         = coreartifacts.SoftDeleteArtifactFilesForUserInput
	UpdateArtifactVisibilityForOwnerInput       = coreartifacts.UpdateArtifactVisibilityForOwnerInput
	CreateArtifactPublicLinkShareInput          = coreartifacts.CreateArtifactPublicLinkShareInput
	RevokeArtifactPublicLinkSharesForOwnerInput = coreartifacts.RevokeArtifactPublicLinkSharesForOwnerInput
)

const (
	ArtifactTypeDocument    = coreartifacts.ArtifactTypeDocument
	ArtifactTypeSpreadsheet = coreartifacts.ArtifactTypeSpreadsheet
	ArtifactTypeChart       = coreartifacts.ArtifactTypeChart
	ArtifactTypeImage       = coreartifacts.ArtifactTypeImage
	ArtifactTypeVideo       = coreartifacts.ArtifactTypeVideo
	ArtifactTypeSite        = coreartifacts.ArtifactTypeSite
	ArtifactTypeDashboard   = coreartifacts.ArtifactTypeDashboard
	ArtifactTypeArchive     = coreartifacts.ArtifactTypeArchive
	ArtifactTypeOther       = coreartifacts.ArtifactTypeOther

	ArtifactStatusProcessing = coreartifacts.ArtifactStatusProcessing
	ArtifactStatusReady      = coreartifacts.ArtifactStatusReady
	ArtifactStatusFailed     = coreartifacts.ArtifactStatusFailed
	ArtifactStatusDeleted    = coreartifacts.ArtifactStatusDeleted

	ArtifactVisibilityPrivate      = coreartifacts.ArtifactVisibilityPrivate
	ArtifactVisibilityOrganization = coreartifacts.ArtifactVisibilityOrganization
	ArtifactVisibilityPublicLink   = coreartifacts.ArtifactVisibilityPublicLink

	ArtifactShareScopeOrganization = coreartifacts.ArtifactShareScopeOrganization
	ArtifactShareScopePublicLink   = coreartifacts.ArtifactShareScopePublicLink
	ArtifactShareScopeUser         = coreartifacts.ArtifactShareScopeUser

	ArtifactPermissionView    = coreartifacts.ArtifactPermissionView
	ArtifactPermissionComment = coreartifacts.ArtifactPermissionComment
	ArtifactPermissionEdit    = coreartifacts.ArtifactPermissionEdit
)

var ErrArtifactNotFound = coreartifacts.ErrArtifactNotFound
