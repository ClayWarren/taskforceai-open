package artifacts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	vercelblob "github.com/claywarren/vercel_blob"

	"github.com/TaskForceAI/adapters/pkg/auth"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
	"github.com/TaskForceAI/go-core/internal/benchmarktest"
)

func BenchmarkArtifactHandlerLatencyProfile(b *testing.B) {
	now := time.Unix(1_700_000_000, 0).UTC()
	artifact := coreartifacts.Artifact{
		ID:          "artifact-benchmark",
		OwnerUserID: 12,
		Type:        coreartifacts.ArtifactTypeDocument,
		Title:       "Benchmark.md",
		Status:      coreartifacts.ArtifactStatusReady,
		Visibility:  coreartifacts.ArtifactVisibilityPrivate,
		Metadata:    []byte(`{"kind":"benchmark"}`),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	service := &mockArtifactService{
		getFunc: func(ctx context.Context, id string, ownerUserID int32, organizationID *int32) (*coreartifacts.Artifact, error) {
			return &artifact, nil
		},
		publicFileFunc: func(ctx context.Context, token string) (*coreartifacts.PublicArtifactFileRecord, error) {
			return &coreartifacts.PublicArtifactFileRecord{
				ID:        "file-benchmark",
				UserID:    12,
				Filename:  "benchmark.md",
				MimeType:  "text/markdown",
				Bytes:     18,
				BlobURL:   "https://blob.example/artifact",
				BlobPath:  "artifact",
				CreatedAt: now,
			}, nil
		},
	}
	router := setupArtifactsRouter(service, &auth.AuthenticatedUser{ID: 12, Email: "artifact-benchmark@example.com"}, 0)
	originalBlobClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return mockBlobClient{
			downloadFunc: func(ctx context.Context, urlPath string, options vercelblob.DownloadCommandOptions) ([]byte, error) {
				return []byte("# Benchmark artifact"), nil
			},
		}
	}
	b.Cleanup(func() { newBlobClient = originalBlobClient })
	b.Setenv("BLOB_READ_WRITE_TOKEN", "test-token")

	b.Run("GetArtifact", func(b *testing.B) {
		benchmarktest.ProfileHTTP(b, router, func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "/api/v1/artifacts/artifact-benchmark", nil)
		})
	})

	b.Run("PublicContent", func(b *testing.B) {
		benchmarktest.ProfileHTTP(b, router, func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "/api/v1/artifacts/public/token-benchmark/content?disposition=inline", nil)
		})
	})
}
