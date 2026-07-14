package artifacts

import (
	"encoding/json"
	"time"

	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
)

type ArtifactResponse struct {
	ID               string                           `json:"id"`
	OrganizationID   *int32                           `json:"organizationId,omitempty"`
	OwnerUserID      int32                            `json:"ownerUserId"`
	ConversationID   *int32                           `json:"conversationId,omitempty"`
	MessageID        *string                          `json:"messageId,omitempty"`
	TaskID           *string                          `json:"taskId,omitempty"`
	Type             coreartifacts.ArtifactType       `json:"type"`
	Title            string                           `json:"title"`
	Status           coreartifacts.ArtifactStatus     `json:"status"`
	Visibility       coreartifacts.ArtifactVisibility `json:"visibility"`
	CurrentVersionID *string                          `json:"currentVersionId,omitempty"`
	CurrentVersion   *ArtifactVersionResponse         `json:"currentVersion,omitempty"`
	Metadata         json.RawMessage                  `json:"metadata,omitempty"`
	CreatedAt        time.Time                        `json:"createdAt"`
	UpdatedAt        time.Time                        `json:"updatedAt"`
}

type ArtifactVersionResponse struct {
	ID              string          `json:"id"`
	ArtifactID      string          `json:"artifactId"`
	Version         int32           `json:"version"`
	FileID          *string         `json:"fileId,omitempty"`
	MimeType        *string         `json:"mimeType,omitempty"`
	Filename        *string         `json:"filename,omitempty"`
	Bytes           *int64          `json:"bytes,omitempty"`
	RenderMetadata  json.RawMessage `json:"renderMetadata,omitempty"`
	SourceToolName  *string         `json:"sourceToolName,omitempty"`
	SourcePrompt    *string         `json:"sourcePrompt,omitempty"`
	CreatedByUserID *int32          `json:"createdByUserId,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
}

type UpdateArtifactRequest struct {
	Visibility coreartifacts.ArtifactVisibility `json:"visibility"`
}

type ArtifactShareResponse struct {
	Token    string           `json:"token"`
	URL      string           `json:"url"`
	Artifact ArtifactResponse `json:"artifact"`
}

type PublicArtifactResponse struct {
	Artifact PublicArtifactMetadataResponse `json:"artifact"`
	Version  PublicArtifactVersionResponse  `json:"version"`
}

type PublicArtifactMetadataResponse struct {
	ID         string                           `json:"id"`
	Type       coreartifacts.ArtifactType       `json:"type"`
	Title      string                           `json:"title"`
	Status     coreartifacts.ArtifactStatus     `json:"status"`
	Visibility coreartifacts.ArtifactVisibility `json:"visibility"`
	CreatedAt  time.Time                        `json:"createdAt"`
	UpdatedAt  time.Time                        `json:"updatedAt"`
}

type PublicArtifactVersionResponse struct {
	ID        string    `json:"id"`
	Version   int32     `json:"version"`
	MimeType  *string   `json:"mimeType,omitempty"`
	Filename  *string   `json:"filename,omitempty"`
	Bytes     *int64    `json:"bytes,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type PublicArtifactContentResponse struct {
	ContentType        string `header:"Content-Type"`
	ContentLength      string `header:"Content-Length"`
	ContentDisposition string `header:"Content-Disposition"`
	ContentSecurity    string `header:"Content-Security-Policy"`
	ContentTypeOptions string `header:"X-Content-Type-Options"`
	FrameOptions       string `header:"X-Frame-Options"`
	Body               []byte
}
