package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
)

type mockArtifactService struct {
	listFunc            func(ctx context.Context, ownerUserID int32, organizationID *int32, limit, offset int32) ([]coreartifacts.Artifact, error)
	getFunc             func(ctx context.Context, id string, ownerUserID int32, organizationID *int32) (*coreartifacts.Artifact, error)
	versionsFunc        func(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) ([]coreartifacts.ArtifactVersion, error)
	currentVersionsFunc func(ctx context.Context, artifactIDs []string, ownerUserID int32, organizationID *int32) (map[string]coreartifacts.ArtifactVersion, error)
	updateFunc          func(ctx context.Context, id string, ownerUserID int32, organizationID *int32, visibility coreartifacts.ArtifactVisibility) (*coreartifacts.Artifact, error)
	createLinkFunc      func(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) (*coreartifacts.PublicLink, error)
	revokeLinksFunc     func(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) error
	publicFunc          func(ctx context.Context, token string) (*coreartifacts.PublicArtifact, error)
	publicFileFunc      func(ctx context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error)
	deleteFunc          func(ctx context.Context, id string, ownerUserID int32, organizationID *int32) error
}

func (m *mockArtifactService) ListArtifacts(ctx context.Context, ownerUserID int32, organizationID *int32, limit, offset int32) ([]coreartifacts.Artifact, error) {
	if m.listFunc != nil {
		return m.listFunc(ctx, ownerUserID, organizationID, limit, offset)
	}
	return nil, nil
}

func (m *mockArtifactService) GetArtifact(ctx context.Context, id string, ownerUserID int32, organizationID *int32) (*coreartifacts.Artifact, error) {
	if m.getFunc != nil {
		return m.getFunc(ctx, id, ownerUserID, organizationID)
	}
	return nil, coreartifacts.ErrArtifactNotFound
}

func (m *mockArtifactService) GetArtifactVersions(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) ([]coreartifacts.ArtifactVersion, error) {
	if m.versionsFunc != nil {
		return m.versionsFunc(ctx, artifactID, ownerUserID, organizationID)
	}
	return nil, nil
}

func (m *mockArtifactService) GetArtifactCurrentVersions(ctx context.Context, artifactIDs []string, ownerUserID int32, organizationID *int32) (map[string]coreartifacts.ArtifactVersion, error) {
	if m.currentVersionsFunc != nil {
		return m.currentVersionsFunc(ctx, artifactIDs, ownerUserID, organizationID)
	}
	return nil, nil
}

func (m *mockArtifactService) UpdateArtifactVisibility(ctx context.Context, id string, ownerUserID int32, organizationID *int32, visibility coreartifacts.ArtifactVisibility) (*coreartifacts.Artifact, error) {
	if m.updateFunc != nil {
		return m.updateFunc(ctx, id, ownerUserID, organizationID, visibility)
	}
	return nil, coreartifacts.ErrArtifactNotFound
}

func (m *mockArtifactService) CreatePublicLink(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) (*coreartifacts.PublicLink, error) {
	if m.createLinkFunc != nil {
		return m.createLinkFunc(ctx, artifactID, ownerUserID, organizationID)
	}
	return nil, coreartifacts.ErrArtifactNotFound
}

func (m *mockArtifactService) RevokePublicLinks(ctx context.Context, artifactID string, ownerUserID int32, organizationID *int32) error {
	if m.revokeLinksFunc != nil {
		return m.revokeLinksFunc(ctx, artifactID, ownerUserID, organizationID)
	}
	return nil
}

func (m *mockArtifactService) GetPublicArtifact(ctx context.Context, token string) (*coreartifacts.PublicArtifact, error) {
	if m.publicFunc != nil {
		return m.publicFunc(ctx, token)
	}
	return nil, coreartifacts.ErrArtifactNotFound
}

func (m *mockArtifactService) GetPublicArtifactFile(ctx context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
	if m.publicFileFunc != nil {
		return m.publicFileFunc(ctx, token)
	}
	return nil, coreartifacts.ErrArtifactNotFound
}

func (m *mockArtifactService) DeleteArtifact(ctx context.Context, id string, ownerUserID int32, organizationID *int32) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, id, ownerUserID, organizationID)
	}
	return nil
}

type mockBlobClient struct {
	downloadFunc func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error)
}

func (m mockBlobClient) Download(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
	return m.downloadFunc(ctx, urlPath, options)
}

func setupArtifactsRouter(service *mockArtifactService, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if orgID != 0 {
					ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, service)
	return r
}

func TestListArtifactsSuccess(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	var capturedOrg *int32
	service := &mockArtifactService{
		listFunc: func(_ context.Context, ownerUserID int32, organizationID *int32, limit, offset int32) ([]coreartifacts.Artifact, error) {
			assert.Equal(t, int32(12), ownerUserID)
			assert.Equal(t, int32(25), limit)
			assert.Equal(t, int32(5), offset)
			capturedOrg = organizationID
			return []coreartifacts.Artifact{{
				ID:             "artifact-1",
				OrganizationID: organizationID,
				OwnerUserID:    ownerUserID,
				Type:           coreartifacts.ArtifactTypeSpreadsheet,
				Title:          "Budget.xlsx",
				Status:         coreartifacts.ArtifactStatusReady,
				Visibility:     coreartifacts.ArtifactVisibilityPrivate,
				Metadata:       []byte(`{"fileId":"file-1"}`),
				CreatedAt:      now,
				UpdatedAt:      now,
			}}, nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 34)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts?limit=25&offset=5")
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(34), *capturedOrg)

	var body []ArtifactResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Len(t, body, 1)
	assert.Equal(t, "artifact-1", body[0].ID)
	assert.Equal(t, coreartifacts.ArtifactTypeSpreadsheet, body[0].Type)
	assert.JSONEq(t, `{"fileId":"file-1"}`, string(body[0].Metadata))
	assert.Nil(t, body[0].CurrentVersion)
}

func TestListArtifactsCanIncludeCurrentVersion(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	currentVersionID := "version-2"
	fileID := "file-2"
	service := &mockArtifactService{
		listFunc: func(_ context.Context, ownerUserID int32, organizationID *int32, limit, offset int32) ([]coreartifacts.Artifact, error) {
			assert.Equal(t, int32(12), ownerUserID)
			assert.Nil(t, organizationID)
			assert.Equal(t, int32(50), limit)
			assert.Equal(t, int32(0), offset)
			return []coreartifacts.Artifact{{
				ID:               "artifact-1",
				OwnerUserID:      ownerUserID,
				Type:             coreartifacts.ArtifactTypeSpreadsheet,
				Title:            "Budget.xlsx",
				Status:           coreartifacts.ArtifactStatusReady,
				Visibility:       coreartifacts.ArtifactVisibilityPrivate,
				CurrentVersionID: &currentVersionID,
				CreatedAt:        now,
				UpdatedAt:        now,
			}}, nil
		},
		currentVersionsFunc: func(_ context.Context, artifactIDs []string, ownerUserID int32, organizationID *int32) (map[string]coreartifacts.ArtifactVersion, error) {
			assert.Equal(t, []string{"artifact-1"}, artifactIDs)
			assert.Equal(t, int32(12), ownerUserID)
			assert.Nil(t, organizationID)
			return map[string]coreartifacts.ArtifactVersion{
				"artifact-1": {
					ID:         currentVersionID,
					ArtifactID: "artifact-1",
					Version:    2,
					FileID:     &fileID,
					CreatedAt:  now,
				},
			}, nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts?limit=50&offset=0&include=currentVersion")
	var body []ArtifactResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Len(t, body, 1)
	require.NotNil(t, body[0].CurrentVersion)
	assert.Equal(t, currentVersionID, body[0].CurrentVersion.ID)
	assert.Equal(t, &fileID, body[0].CurrentVersion.FileID)
}

func TestGetArtifactNotFound(t *testing.T) {
	service := &mockArtifactService{
		getFunc: func(context.Context, string, int32, *int32) (*coreartifacts.Artifact, error) {
			return nil, coreartifacts.ErrArtifactNotFound
		},
	}
	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	serveRequest(t, router, http.StatusNotFound, http.MethodGet, "/api/v1/artifacts/missing")
}

func TestGetArtifactSuccess(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	service := &mockArtifactService{
		getFunc: func(_ context.Context, id string, ownerUserID int32, organizationID *int32) (*coreartifacts.Artifact, error) {
			assert.Equal(t, "artifact-1", id)
			assert.Equal(t, int32(12), ownerUserID)
			require.Nil(t, organizationID)
			return &coreartifacts.Artifact{
				ID:          id,
				OwnerUserID: ownerUserID,
				Type:        coreartifacts.ArtifactTypeDocument,
				Title:       "Notes.md",
				Status:      coreartifacts.ArtifactStatusReady,
				Visibility:  coreartifacts.ArtifactVisibilityPrivate,
				Metadata:    []byte(`{"source":"task"}`),
				CreatedAt:   now,
				UpdatedAt:   now,
			}, nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts/artifact-1")
	var body ArtifactResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "artifact-1", body.ID)
	assert.Equal(t, coreartifacts.ArtifactTypeDocument, body.Type)
	assert.JSONEq(t, `{"source":"task"}`, string(body.Metadata))
}

func TestGetArtifactVersionsSuccess(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	fileID := "file-1"
	service := &mockArtifactService{
		versionsFunc: func(_ context.Context, artifactID string, ownerUserID int32, organizationID *int32) ([]coreartifacts.ArtifactVersion, error) {
			assert.Equal(t, "artifact-1", artifactID)
			assert.Equal(t, int32(12), ownerUserID)
			assert.Nil(t, organizationID)
			return []coreartifacts.ArtifactVersion{{
				ID:             "version-1",
				ArtifactID:     artifactID,
				Version:        1,
				FileID:         &fileID,
				RenderMetadata: []byte(`{"entrypointPath":"index.html"}`),
				CreatedAt:      now,
			}}, nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts/artifact-1/versions")
	var body []ArtifactVersionResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Len(t, body, 1)
	assert.Equal(t, "version-1", body[0].ID)
	assert.Equal(t, &fileID, body[0].FileID)
	assert.JSONEq(t, `{"entrypointPath":"index.html"}`, string(body[0].RenderMetadata))
}

func TestDeleteArtifactSuccess(t *testing.T) {
	var capturedID string
	service := &mockArtifactService{
		deleteFunc: func(_ context.Context, id string, ownerUserID int32, organizationID *int32) error {
			capturedID = id
			assert.Equal(t, int32(12), ownerUserID)
			return nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	serveRequest(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/artifacts/artifact-1")
	assert.Equal(t, "artifact-1", capturedID)
}

func TestUpdateArtifactVisibilitySuccess(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	orgID := int32(34)
	service := &mockArtifactService{
		updateFunc: func(_ context.Context, id string, ownerUserID int32, organizationID *int32, visibility coreartifacts.ArtifactVisibility) (*coreartifacts.Artifact, error) {
			assert.Equal(t, "artifact-1", id)
			assert.Equal(t, int32(12), ownerUserID)
			require.NotNil(t, organizationID)
			assert.Equal(t, orgID, *organizationID)
			assert.Equal(t, coreartifacts.ArtifactVisibilityOrganization, visibility)
			return &coreartifacts.Artifact{
				ID:             id,
				OrganizationID: organizationID,
				OwnerUserID:    ownerUserID,
				Type:           coreartifacts.ArtifactTypeSite,
				Title:          "Review.html",
				Status:         coreartifacts.ArtifactStatusReady,
				Visibility:     visibility,
				CreatedAt:      now,
				UpdatedAt:      now,
			}, nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, int(orgID))
	resp := serveJSONRequest(t, router, http.StatusOK, http.MethodPatch, "/api/v1/artifacts/artifact-1", strings.NewReader(`{"visibility":"ORGANIZATION"}`))
	var body ArtifactResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, coreartifacts.ArtifactVisibilityOrganization, body.Visibility)
	assert.Equal(t, coreartifacts.ArtifactTypeSite, body.Type)
}

func TestUpdateArtifactVisibilityInvalidInputReturns422(t *testing.T) {
	service := &mockArtifactService{
		updateFunc: func(_ context.Context, id string, ownerUserID int32, organizationID *int32, visibility coreartifacts.ArtifactVisibility) (*coreartifacts.Artifact, error) {
			assert.Equal(t, "artifact-1", id)
			assert.Equal(t, int32(12), ownerUserID)
			assert.Equal(t, coreartifacts.ArtifactVisibility("PUBLIC"), visibility)
			return nil, coreartifacts.ErrInvalidArtifactInput
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	serveJSONRequest(t, router, http.StatusUnprocessableEntity, http.MethodPatch, "/api/v1/artifacts/artifact-1", strings.NewReader(`{"visibility":"PUBLIC"}`))
}

func TestCreatePublicArtifactLinkSuccess(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	service := &mockArtifactService{
		createLinkFunc: func(_ context.Context, artifactID string, ownerUserID int32, organizationID *int32) (*coreartifacts.PublicLink, error) {
			assert.Equal(t, "artifact-1", artifactID)
			assert.Equal(t, int32(12), ownerUserID)
			return &coreartifacts.PublicLink{
				Token: "public-token",
				Artifact: coreartifacts.Artifact{
					ID:          artifactID,
					OwnerUserID: ownerUserID,
					Type:        coreartifacts.ArtifactTypeSite,
					Title:       "Review.html",
					Status:      coreartifacts.ArtifactStatusReady,
					Visibility:  coreartifacts.ArtifactVisibilityPublicLink,
					CreatedAt:   now,
					UpdatedAt:   now,
				},
			}, nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/artifacts/artifact-1/share/public")
	var body ArtifactShareResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "public-token", body.Token)
	assert.Equal(t, "https://taskforceai.chat/artifacts/public/public-token", body.URL)
	assert.Equal(t, coreartifacts.ArtifactVisibilityPublicLink, body.Artifact.Visibility)
}

func TestRevokePublicArtifactLinksSuccess(t *testing.T) {
	called := false
	service := &mockArtifactService{
		revokeLinksFunc: func(_ context.Context, artifactID string, ownerUserID int32, organizationID *int32) error {
			called = true
			assert.Equal(t, "artifact-1", artifactID)
			assert.Equal(t, int32(12), ownerUserID)
			return nil
		},
	}

	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	serveRequest(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/artifacts/artifact-1/share/public")
	assert.True(t, called)
}

func TestGetPublicArtifactSuccess(t *testing.T) {
	now := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	orgID := int32(34)
	conversationID := int32(56)
	messageID := "message-1"
	taskID := "task-1"
	fileID := "file-1"
	filename := "review.html"
	bytes := int64(1024)
	sourceToolName := "site-generator"
	sourcePrompt := "internal prompt text"
	createdByUserID := int32(12)
	service := &mockArtifactService{
		publicFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifact, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifact{
				Token: token,
				Artifact: coreartifacts.Artifact{
					ID:             "artifact-1",
					OrganizationID: &orgID,
					OwnerUserID:    12,
					ConversationID: &conversationID,
					MessageID:      &messageID,
					TaskID:         &taskID,
					Type:           coreartifacts.ArtifactTypeSite,
					Title:          "Review.html",
					Status:         coreartifacts.ArtifactStatusReady,
					Visibility:     coreartifacts.ArtifactVisibilityPublicLink,
					Metadata:       []byte(`{"internal":"metadata"}`),
					CreatedAt:      now,
					UpdatedAt:      now,
				},
				Version: coreartifacts.ArtifactVersion{
					ID:              "version-1",
					ArtifactID:      "artifact-1",
					Version:         1,
					FileID:          &fileID,
					MimeType:        new("text/html"),
					Filename:        &filename,
					Bytes:           &bytes,
					RenderMetadata:  []byte(`{"entrypointPath":"index.html"}`),
					SourceToolName:  &sourceToolName,
					SourcePrompt:    &sourcePrompt,
					CreatedByUserID: &createdByUserID,
					CreatedAt:       now,
				},
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts/public/public-token")
	var body PublicArtifactResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "artifact-1", body.Artifact.ID)
	assert.Equal(t, "version-1", body.Version.ID)
	assert.Equal(t, coreartifacts.ArtifactTypeSite, body.Artifact.Type)
	assert.Equal(t, coreartifacts.ArtifactStatusReady, body.Artifact.Status)
	assert.Equal(t, coreartifacts.ArtifactVisibilityPublicLink, body.Artifact.Visibility)
	assert.Equal(t, "Review.html", body.Artifact.Title)
	assert.Equal(t, &filename, body.Version.Filename)
	assert.Equal(t, &bytes, body.Version.Bytes)
	assert.NotContains(t, resp.Body.String(), "ownerUserId")
	assert.NotContains(t, resp.Body.String(), "organizationId")
	assert.NotContains(t, resp.Body.String(), "conversationId")
	assert.NotContains(t, resp.Body.String(), "messageId")
	assert.NotContains(t, resp.Body.String(), "taskId")
	assert.NotContains(t, resp.Body.String(), "fileId")
	assert.NotContains(t, resp.Body.String(), "artifactId")
	assert.NotContains(t, resp.Body.String(), "metadata")
	assert.NotContains(t, resp.Body.String(), "renderMetadata")
	assert.NotContains(t, resp.Body.String(), "sourceToolName")
	assert.NotContains(t, resp.Body.String(), "sourcePrompt")
	assert.NotContains(t, resp.Body.String(), "createdByUserId")
}

func TestGetPublicArtifactContentAllowsInlineDisposition(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "blob-token")
	originalBlobClient := newBlobClient
	t.Cleanup(func() {
		newBlobClient = originalBlobClient
	})
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "blob-token", token)
		return mockBlobClient{
			downloadFunc: func(_ context.Context, urlPath string, _ vercelblob.DownloadCommandOptions) ([]byte, error) {
				assert.Equal(t, "https://blob.example/review.html", urlPath)
				return []byte("<!doctype html><title>Review</title>"), nil
			},
		}
	}
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: "review.html",
				MimeType: "text/html",
				BlobURL:  "https://blob.example/review.html",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts/public/public-token/content?disposition=inline")
	assert.Equal(t, "text/html", resp.Header().Get("Content-Type"))
	assert.Contains(t, resp.Header().Get("Content-Disposition"), "inline")
	assert.Contains(t, resp.Header().Get("Content-Disposition"), "review.html")
	assert.Equal(t, "nosniff", resp.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "SAMEORIGIN", resp.Header().Get("X-Frame-Options"))
	csp := resp.Header().Get("Content-Security-Policy")
	assert.Contains(t, csp, "sandbox allow-scripts")
	assert.NotContains(t, csp, "allow-same-origin")
	assert.Contains(t, csp, "frame-ancestors 'self'")
	assert.Equal(t, "<!doctype html><title>Review</title>", resp.Body.String())
}

func TestGetPublicArtifactContentAttachmentKeepsDenyFramePolicy(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "blob-token")
	originalBlobClient := newBlobClient
	t.Cleanup(func() {
		newBlobClient = originalBlobClient
	})
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "blob-token", token)
		return mockBlobClient{
			downloadFunc: func(_ context.Context, _ string, _ vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("<svg><script>alert(1)</script></svg>"), nil
			},
		}
	}
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: "chart.svg",
				MimeType: "image/svg+xml",
				BlobURL:  "https://blob.example/chart.svg",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts/public/public-token/content")
	assert.Equal(t, `attachment; filename=chart.svg`, resp.Header().Get("Content-Disposition"))
	assert.Equal(t, "DENY", resp.Header().Get("X-Frame-Options"))
	assert.Contains(t, resp.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'")
}

func TestGetPublicArtifactContentDefaultsMimeAndSanitizesInlineFilename(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "blob-token")
	originalBlobClient := newBlobClient
	t.Cleanup(func() {
		newBlobClient = originalBlobClient
	})
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "blob-token", token)
		return mockBlobClient{
			downloadFunc: func(_ context.Context, _ string, _ vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("plain content"), nil
			},
		}
	}
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: " ../bad\\name\x00.txt ",
				MimeType: "",
				BlobURL:  "https://blob.example/plain",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/artifacts/public/public-token/content?disposition=inline")
	assert.Equal(t, "application/octet-stream", resp.Header().Get("Content-Type"))
	assert.Contains(t, resp.Header().Get("Content-Disposition"), "inline")
	assert.Contains(t, resp.Header().Get("Content-Disposition"), ".._bad_name.txt")
	assert.Equal(t, "SAMEORIGIN", resp.Header().Get("X-Frame-Options"))
	csp := resp.Header().Get("Content-Security-Policy")
	assert.NotContains(t, csp, "sandbox allow-scripts")
	assert.Contains(t, csp, "frame-ancestors 'self'")
}

func TestGetPublicArtifactContentReturns413WhenMetadataExceedsPayloadLimit(t *testing.T) {
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: "large.zip",
				MimeType: "application/zip",
				Bytes:    int64(server.VercelFunctionSafeBinaryPayloadBytes) + 1,
				BlobURL:  "https://blob.example/large.zip",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	serveRequest(t, router, http.StatusRequestEntityTooLarge, http.MethodGet, "/api/v1/artifacts/public/public-token/content")
}

func TestGetPublicArtifactContentReturns500WhenBlobTokenMissing(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: "review.html",
				MimeType: "text/html",
				BlobURL:  "https://blob.example/review.html",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	serveRequest(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/artifacts/public/public-token/content")
}

func TestGetPublicArtifactContentReturns500WhenBlobDownloadFails(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "blob-token")
	originalBlobClient := newBlobClient
	t.Cleanup(func() {
		newBlobClient = originalBlobClient
	})
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "blob-token", token)
		return mockBlobClient{
			downloadFunc: func(_ context.Context, _ string, _ vercelblob.DownloadCommandOptions) ([]byte, error) {
				return nil, errors.New("blob unavailable")
			},
		}
	}
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: "review.html",
				MimeType: "text/html",
				BlobURL:  "https://blob.example/review.html",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	serveRequest(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/artifacts/public/public-token/content")
}

func TestGetPublicArtifactContentReturns413WhenDownloadedContentExceedsPayloadLimit(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "blob-token")
	originalBlobClient := newBlobClient
	t.Cleanup(func() {
		newBlobClient = originalBlobClient
	})
	newBlobClient = func(token string) blobClient {
		assert.Equal(t, "blob-token", token)
		return mockBlobClient{
			downloadFunc: func(_ context.Context, _ string, _ vercelblob.DownloadCommandOptions) ([]byte, error) {
				return make([]byte, server.VercelFunctionSafeBinaryPayloadBytes+1), nil
			},
		}
	}
	service := &mockArtifactService{
		publicFileFunc: func(_ context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			assert.Equal(t, "public-token", token)
			return &coreartifacts.PublicArtifactFileRecord{
				ID:       "file-1",
				UserID:   12,
				Filename: "large.bin",
				MimeType: "application/octet-stream",
				BlobURL:  "https://blob.example/large.bin",
			}, nil
		},
	}

	router := setupArtifactsRouter(service, nil, 0)
	serveRequest(t, router, http.StatusRequestEntityTooLarge, http.MethodGet, "/api/v1/artifacts/public/public-token/content")
}

func TestListArtifactsServiceError(t *testing.T) {
	service := &mockArtifactService{
		listFunc: func(context.Context, int32, *int32, int32, int32) ([]coreartifacts.Artifact, error) {
			return nil, errors.New("db unavailable")
		},
	}
	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)
	serveRequest(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/artifacts")
}

func TestAuthenticatedArtifactRoutesRejectInvalidResolvedUserID(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/artifacts"},
		{name: "get", method: http.MethodGet, path: "/api/v1/artifacts/artifact-1"},
		{name: "versions", method: http.MethodGet, path: "/api/v1/artifacts/artifact-1/versions"},
		{name: "update", method: http.MethodPatch, path: "/api/v1/artifacts/artifact-1", body: `{"visibility":"ORGANIZATION"}`},
		{name: "create public link", method: http.MethodPost, path: "/api/v1/artifacts/artifact-1/share/public"},
		{name: "revoke public links", method: http.MethodDelete, path: "/api/v1/artifacts/artifact-1/share/public"},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/artifacts/artifact-1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := setupArtifactsRouter(&mockArtifactService{}, &auth.AuthenticatedUser{ID: 1 << 40}, 0)
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusBadRequest, resp.Code)
		})
	}
}

func TestArtifactRouteServiceErrors(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		path    string
		service *mockArtifactService
		status  int
	}{
		{
			name:   "list current version error",
			method: http.MethodGet,
			path:   "/api/v1/artifacts?include=currentVersion",
			service: &mockArtifactService{
				listFunc: func(context.Context, int32, *int32, int32, int32) ([]coreartifacts.Artifact, error) {
					currentVersionID := "version-1"
					return []coreartifacts.Artifact{{ID: "artifact-1", CurrentVersionID: &currentVersionID}}, nil
				},
				currentVersionsFunc: func(context.Context, []string, int32, *int32) (map[string]coreartifacts.ArtifactVersion, error) {
					return nil, errors.New("versions unavailable")
				},
			},
			status: http.StatusInternalServerError,
		},
		{
			name:   "versions error",
			method: http.MethodGet,
			path:   "/api/v1/artifacts/artifact-1/versions",
			service: &mockArtifactService{
				versionsFunc: func(context.Context, string, int32, *int32) ([]coreartifacts.ArtifactVersion, error) {
					return nil, errors.New("versions unavailable")
				},
			},
			status: http.StatusInternalServerError,
		},
		{
			name:   "create public link error",
			method: http.MethodPost,
			path:   "/api/v1/artifacts/artifact-1/share/public",
			service: &mockArtifactService{
				createLinkFunc: func(context.Context, string, int32, *int32) (*coreartifacts.PublicLink, error) {
					return nil, errors.New("share unavailable")
				},
			},
			status: http.StatusInternalServerError,
		},
		{
			name:   "revoke public links error",
			method: http.MethodDelete,
			path:   "/api/v1/artifacts/artifact-1/share/public",
			service: &mockArtifactService{
				revokeLinksFunc: func(context.Context, string, int32, *int32) error {
					return errors.New("revoke unavailable")
				},
			},
			status: http.StatusInternalServerError,
		},
		{
			name:   "public artifact error",
			method: http.MethodGet,
			path:   "/api/v1/artifacts/public/public-token",
			service: &mockArtifactService{
				publicFunc: func(context.Context, string) (*coreartifacts.PublicArtifact, error) {
					return nil, coreartifacts.ErrArtifactNotFound
				},
			},
			status: http.StatusNotFound,
		},
		{
			name:   "public content file error",
			method: http.MethodGet,
			path:   "/api/v1/artifacts/public/public-token/content",
			service: &mockArtifactService{
				publicFileFunc: func(context.Context, string) (*coreartifacts.PublicArtifactFileRecord, error) {
					return nil, coreartifacts.ErrArtifactNotFound
				},
			},
			status: http.StatusNotFound,
		},
		{
			name:   "delete error",
			method: http.MethodDelete,
			path:   "/api/v1/artifacts/artifact-1",
			service: &mockArtifactService{
				deleteFunc: func(context.Context, string, int32, *int32) error {
					return errors.New("delete unavailable")
				},
			},
			status: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := setupArtifactsRouter(tt.service, &auth.AuthenticatedUser{ID: 12}, 0)
			serveRequest(t, router, tt.status, tt.method, tt.path)
		})
	}
}

func TestPublicArtifactURLPrefersConfiguredBaseURL(t *testing.T) {
	t.Setenv("PUBLIC_APP_URL", "https://app.example/")
	t.Setenv("APP_URL", "https://fallback.example")

	assert.Equal(t, "https://app.example/artifacts/public/public-token", publicArtifactURL("public-token"))
}

func TestBlobTokenProviderAndClientFactory(t *testing.T) {
	provider := &envTokenProvider{token: "blob-token"}
	token, err := provider.GetToken("audience", "scope")
	require.NoError(t, err)
	assert.Equal(t, "blob-token", token)
	assert.NotNil(t, newBlobClient("blob-token"))
}

func TestArtifactContentHelpersCoverFallbacks(t *testing.T) {
	assert.False(t, isActiveArtifactContent(" text/html; charset=\"unterminated"))
	assert.Equal(t, "artifact", sanitizeFilename(" \t "))
}

//go:fix inline
