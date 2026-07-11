package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
)

type Service interface {
	ListArtifacts(ctx context.Context, ownerUserID int32, organizationID *int32, limit, offset int32) ([]coreartifacts.Artifact, error)
	GetArtifact(ctx context.Context, id string, ownerUserID int32, organizationID *int32) (*coreartifacts.Artifact, error)
	GetArtifactVersions(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) ([]coreartifacts.ArtifactVersion, error)
	GetArtifactCurrentVersions(ctx context.Context, artifactIDs []string, ownerUserID int32, organizationID *int32) (map[string]coreartifacts.ArtifactVersion, error)
	UpdateArtifactVisibility(ctx context.Context, id string, ownerUserID int32, organizationID *int32, visibility coreartifacts.ArtifactVisibility) (*coreartifacts.Artifact, error)
	CreatePublicLink(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) (*coreartifacts.PublicLink, error)
	RevokePublicLinks(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) error
	GetPublicArtifact(ctx context.Context, token string) (*coreartifacts.PublicArtifact, error)
	GetPublicArtifactFile(ctx context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error)
	DeleteArtifact(ctx context.Context, id string, ownerUserID int32, organizationID *int32) error
}

type blobClient interface {
	Download(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error)
}

type envTokenProvider struct{ token string }

func (p *envTokenProvider) GetToken(_, _ string) (string, error) { return p.token, nil }

var newBlobClient = func(token string) blobClient {
	return vercelblob.NewClientExternal(&envTokenProvider{token: token})
}

func RegisterHandlers(api huma.API, service Service) {
	registerListArtifacts(api, service)
	registerGetArtifact(api, service)
	registerListArtifactVersions(api, service)
	registerUpdateArtifact(api, service)
	registerCreatePublicLink(api, service)
	registerRevokePublicLinks(api, service)
	registerGetPublicArtifact(api, service)
	registerGetPublicArtifactContent(api, service)
	registerDeleteArtifact(api, service)
}

func registerListArtifacts(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-artifacts",
		Method:      http.MethodGet,
		Path:        "/api/v1/artifacts",
		Summary:     "List artifacts",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		Limit   int32  `query:"limit" minimum:"1" maximum:"100" doc:"Maximum artifacts to return"`
		Offset  int32  `query:"offset" minimum:"0" doc:"Artifact offset"`
		Include string `query:"include" doc:"Optional related records to include"`
		handler.AuthContext
	}) (*struct{ Body []ArtifactResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		rows, err := service.ListArtifacts(ctx, ids.UserID32, ids.OrgID32, input.Limit, input.Offset)
		if err != nil {
			slog.Error("Failed to list artifacts", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, mapArtifactError(err, "Failed to list artifacts")
		}
		response := mapArtifacts(rows)
		if includeCurrentVersion(input.Include) {
			versions, err := service.GetArtifactCurrentVersions(ctx, artifactIDsWithCurrentVersion(rows), ids.UserID32, ids.OrgID32)
			if err != nil {
				slog.Error("Failed to fetch artifact current versions", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
				return nil, mapArtifactError(err, "Failed to list artifacts")
			}
			for i, artifact := range rows {
				if current, ok := versions[artifact.ID]; ok {
					mapped := mapArtifactVersion(current)
					response[i].CurrentVersion = &mapped
				}
			}
		}
		return &struct{ Body []ArtifactResponse }{Body: response}, nil
	})
}

func registerGetArtifact(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-artifact",
		Method:      http.MethodGet,
		Path:        "/api/v1/artifacts/{id}",
		Summary:     "Get artifact",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Artifact ID"`
		handler.AuthContext
	}) (*struct{ Body ArtifactResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		artifact, err := service.GetArtifact(ctx, input.ID, ids.UserID32, ids.OrgID32)
		if err != nil {
			slog.Error("Failed to fetch artifact", "artifactId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, mapArtifactError(err, "Failed to fetch artifact")
		}
		return &struct{ Body ArtifactResponse }{Body: mapArtifact(*artifact)}, nil
	})
}

func registerListArtifactVersions(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-artifact-versions",
		Method:      http.MethodGet,
		Path:        "/api/v1/artifacts/{id}/versions",
		Summary:     "List artifact versions",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Artifact ID"`
		handler.AuthContext
	}) (*struct{ Body []ArtifactVersionResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		versions, err := service.GetArtifactVersions(ctx, input.ID, ids.UserID32, ids.OrgID32)
		if err != nil {
			slog.Error("Failed to fetch artifact versions", "artifactId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, mapArtifactError(err, "Failed to fetch artifact versions")
		}
		return &struct{ Body []ArtifactVersionResponse }{Body: mapArtifactVersions(versions)}, nil
	})
}

func registerUpdateArtifact(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "update-artifact",
		Method:      http.MethodPatch,
		Path:        "/api/v1/artifacts/{id}",
		Summary:     "Update artifact",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		ID   string `path:"id" doc:"Artifact ID"`
		Body UpdateArtifactRequest
		handler.AuthContext
	}) (*struct{ Body ArtifactResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		artifact, err := service.UpdateArtifactVisibility(ctx, input.ID, ids.UserID32, ids.OrgID32, input.Body.Visibility)
		if err != nil {
			slog.Error("Failed to update artifact", "artifactId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "visibility", input.Body.Visibility, "error", err)
			return nil, mapArtifactError(err, "Failed to update artifact")
		}
		return &struct{ Body ArtifactResponse }{Body: mapArtifact(*artifact)}, nil
	})
}

func registerCreatePublicLink(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "create-artifact-public-link",
		Method:      http.MethodPost,
		Path:        "/api/v1/artifacts/{id}/share/public",
		Summary:     "Create public artifact link",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Artifact ID"`
		handler.AuthContext
	}) (*struct{ Body ArtifactShareResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		link, err := service.CreatePublicLink(ctx, input.ID, ids.UserID32, ids.OrgID32)
		if err != nil {
			slog.Error("Failed to create public artifact link", "artifactId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, mapArtifactError(err, "Failed to create public artifact link")
		}
		return &struct{ Body ArtifactShareResponse }{Body: ArtifactShareResponse{
			Token:    link.Token,
			URL:      publicArtifactURL(link.Token),
			Artifact: mapArtifact(link.Artifact),
		}}, nil
	})
}

func registerRevokePublicLinks(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "revoke-artifact-public-links",
		Method:      http.MethodDelete,
		Path:        "/api/v1/artifacts/{id}/share/public",
		Summary:     "Revoke public artifact links",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Artifact ID"`
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		if err := service.RevokePublicLinks(ctx, input.ID, ids.UserID32, ids.OrgID32); err != nil {
			slog.Error("Failed to revoke public artifact links", "artifactId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, mapArtifactError(err, "Failed to revoke public artifact links")
		}
		return &struct{}{}, nil
	})
}

func registerGetPublicArtifact(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-public-artifact",
		Method:      http.MethodGet,
		Path:        "/api/v1/artifacts/public/{token}",
		Summary:     "Get public artifact",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		Token string `path:"token" doc:"Public artifact token"`
	}) (*struct{ Body PublicArtifactResponse }, error) {
		artifact, err := service.GetPublicArtifact(ctx, input.Token)
		if err != nil {
			return nil, mapArtifactError(err, "Failed to fetch public artifact")
		}
		return &struct{ Body PublicArtifactResponse }{Body: PublicArtifactResponse{
			Artifact: mapPublicArtifact(artifact.Artifact),
			Version:  mapPublicArtifactVersion(artifact.Version),
		}}, nil
	})
}

func registerGetPublicArtifactContent(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-public-artifact-content",
		Method:      http.MethodGet,
		Path:        "/api/v1/artifacts/public/{token}/content",
		Summary:     "Get public artifact content",
		Tags:        []string{"Artifacts"},
		Responses: map[string]*huma.Response{
			"200": {
				Description: "Artifact content",
				Content: map[string]*huma.MediaType{
					"application/octet-stream": {
						Schema: &huma.Schema{Type: "string", Format: "binary"},
					},
				},
			},
		},
	}, func(ctx context.Context, input *struct {
		Token       string `path:"token" doc:"Public artifact token"`
		Disposition string `query:"disposition" enum:"attachment,inline" doc:"Content disposition mode"`
	}) (*PublicArtifactContentResponse, error) {
		file, err := service.GetPublicArtifactFile(ctx, input.Token)
		if err != nil {
			return nil, mapArtifactError(err, "Failed to fetch public artifact content")
		}
		if file.Bytes > 0 && server.BinaryPayloadExceedsVercelLimit(file.Bytes) {
			return nil, server.PayloadTooLargeError("Artifact content is too large for inline download")
		}
		content, err := downloadPublicArtifactBlob(ctx, file.BlobURL)
		if err != nil {
			slog.Error("Failed to download public artifact blob", "fileId", file.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch public artifact content")
		}
		if server.BinaryPayloadExceedsVercelLimit(int64(len(content))) {
			return nil, server.PayloadTooLargeError("Artifact content is too large for inline download")
		}
		contentType := strings.TrimSpace(file.MimeType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		return &PublicArtifactContentResponse{
			ContentType:        contentType,
			ContentLength:      strconv.Itoa(len(content)),
			ContentDisposition: publicContentDisposition(input.Disposition, file.Filename),
			ContentSecurity:    artifactContentSecurityPolicy(contentType, input.Disposition),
			ContentTypeOptions: "nosniff",
			FrameOptions:       artifactFrameOptions(input.Disposition),
			Body:               content,
		}, nil
	})
}

func registerDeleteArtifact(api huma.API, service Service) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-artifact",
		Method:      http.MethodDelete,
		Path:        "/api/v1/artifacts/{id}",
		Summary:     "Delete artifact",
		Tags:        []string{"Artifacts"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Artifact ID"`
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.DeleteArtifact(ctx, input.ID, ids.UserID32, ids.OrgID32); err != nil {
			slog.Error("Failed to delete artifact", "artifactId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, mapArtifactError(err, "Failed to delete artifact")
		}
		return &struct{}{}, nil
	})
}

func mapArtifactError(err error, message string) error {
	if errors.Is(err, coreartifacts.ErrInvalidArtifactInput) {
		return huma.Error422UnprocessableEntity("Invalid artifact request")
	}
	if errors.Is(err, coreartifacts.ErrArtifactNotFound) {
		return huma.Error404NotFound("Artifact not found")
	}
	return huma.Error500InternalServerError(message)
}

func mapArtifacts(rows []coreartifacts.Artifact) []ArtifactResponse {
	resp := make([]ArtifactResponse, len(rows))
	for i, row := range rows {
		resp[i] = mapArtifact(row)
	}
	return resp
}

func mapArtifact(row coreartifacts.Artifact) ArtifactResponse {
	return ArtifactResponse{
		ID:               row.ID,
		OrganizationID:   row.OrganizationID,
		OwnerUserID:      row.OwnerUserID,
		ConversationID:   row.ConversationID,
		MessageID:        row.MessageID,
		TaskID:           row.TaskID,
		Type:             row.Type,
		Title:            row.Title,
		Status:           row.Status,
		Visibility:       row.Visibility,
		CurrentVersionID: row.CurrentVersionID,
		Metadata:         rawJSON(row.Metadata),
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func mapPublicArtifact(row coreartifacts.Artifact) PublicArtifactMetadataResponse {
	return PublicArtifactMetadataResponse{
		ID:         row.ID,
		Type:       row.Type,
		Title:      row.Title,
		Status:     row.Status,
		Visibility: row.Visibility,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
	}
}

func mapArtifactVersions(rows []coreartifacts.ArtifactVersion) []ArtifactVersionResponse {
	resp := make([]ArtifactVersionResponse, len(rows))
	for i, row := range rows {
		resp[i] = mapArtifactVersion(row)
	}
	return resp
}

func mapArtifactVersion(row coreartifacts.ArtifactVersion) ArtifactVersionResponse {
	return ArtifactVersionResponse{
		ID:              row.ID,
		ArtifactID:      row.ArtifactID,
		Version:         row.Version,
		FileID:          row.FileID,
		MimeType:        row.MimeType,
		Filename:        row.Filename,
		Bytes:           row.Bytes,
		RenderMetadata:  rawJSON(row.RenderMetadata),
		SourceToolName:  row.SourceToolName,
		SourcePrompt:    row.SourcePrompt,
		CreatedByUserID: row.CreatedByUserID,
		CreatedAt:       row.CreatedAt,
	}
}

func mapPublicArtifactVersion(row coreartifacts.ArtifactVersion) PublicArtifactVersionResponse {
	return PublicArtifactVersionResponse{
		ID:        row.ID,
		Version:   row.Version,
		MimeType:  row.MimeType,
		Filename:  row.Filename,
		Bytes:     row.Bytes,
		CreatedAt: row.CreatedAt,
	}
}

func includeCurrentVersion(include string) bool {
	for _, part := range strings.Split(include, ",") {
		if strings.EqualFold(strings.TrimSpace(part), "currentVersion") {
			return true
		}
	}
	return false
}

func artifactIDsWithCurrentVersion(rows []coreartifacts.Artifact) []string {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.CurrentVersionID != nil {
			ids = append(ids, row.ID)
		}
	}
	return ids
}

func rawJSON(value []byte) json.RawMessage {
	if !json.Valid(value) {
		return nil
	}
	return json.RawMessage(value)
}

func publicArtifactURL(token string) string {
	baseURL := strings.TrimRight(os.Getenv("PUBLIC_APP_URL"), "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(os.Getenv("APP_URL"), "/")
	}
	if baseURL == "" {
		baseURL = "https://taskforceai.chat"
	}
	return baseURL + "/artifacts/public/" + token
}

func downloadPublicArtifactBlob(ctx context.Context, blobURL string) ([]byte, error) {
	token := strings.TrimSpace(os.Getenv("BLOB_READ_WRITE_TOKEN"))
	if token == "" {
		return nil, errors.New("blob storage unavailable")
	}
	return newBlobClient(token).Download(ctx, blobURL, vercelblob.DownloadCommandOptions{})
}

func publicContentDisposition(disposition string, filename string) string {
	mode := "attachment"
	if strings.EqualFold(strings.TrimSpace(disposition), "inline") {
		mode = "inline"
	}
	return mime.FormatMediaType(mode, map[string]string{"filename": sanitizeFilename(filename)})
}

func artifactContentSecurityPolicy(contentType string, disposition string) string {
	if !isInlineDisposition(disposition) {
		return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
	}
	if isActiveArtifactContent(contentType) {
		return "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https:; style-src 'unsafe-inline' data: blob: https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: blob: https:; connect-src https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
	}
	return "default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
}

func artifactFrameOptions(disposition string) string {
	if isInlineDisposition(disposition) {
		return "SAMEORIGIN"
	}
	return "DENY"
}

func isInlineDisposition(disposition string) bool {
	return strings.EqualFold(strings.TrimSpace(disposition), "inline")
}

func isActiveArtifactContent(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(strings.ToLower(contentType)))
	if err != nil {
		mediaType = strings.TrimSpace(strings.ToLower(contentType))
	}
	switch mediaType {
	case "text/html", "application/xhtml+xml", "image/svg+xml":
		return true
	default:
		return false
	}
}

func sanitizeFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "artifact"
	}
	filename = strings.NewReplacer("/", "_", "\\", "_", "\x00", "").Replace(filename)
	return filename
}
