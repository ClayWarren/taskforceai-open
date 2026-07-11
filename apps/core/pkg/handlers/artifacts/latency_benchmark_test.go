package artifacts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	vercelblob "github.com/claywarren/vercel_blob"

	"github.com/TaskForceAI/adapters/pkg/auth"
	coreartifacts "github.com/TaskForceAI/core/pkg/artifacts"
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
		samples := make([]time.Duration, 0, b.N)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/artifacts/artifact-benchmark", nil)
			resp := httptest.NewRecorder()
			startedAt := time.Now()
			router.ServeHTTP(resp, req)
			samples = append(samples, time.Since(startedAt))
			if resp.Code != http.StatusOK {
				b.Fatalf("unexpected get artifact status: %d", resp.Code)
			}
		}
		b.StopTimer()
		reportArtifactHandlerLatencyProfile(b, samples)
	})

	b.Run("PublicContent", func(b *testing.B) {
		samples := make([]time.Duration, 0, b.N)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/artifacts/public/token-benchmark/content?disposition=inline", nil)
			resp := httptest.NewRecorder()
			startedAt := time.Now()
			router.ServeHTTP(resp, req)
			samples = append(samples, time.Since(startedAt))
			if resp.Code != http.StatusOK {
				b.Fatalf("unexpected public artifact content status: %d", resp.Code)
			}
		}
		b.StopTimer()
		reportArtifactHandlerLatencyProfile(b, samples)
	})
}

func reportArtifactHandlerLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(artifactDurationMicroseconds(artifactPercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(artifactDurationMicroseconds(artifactPercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(artifactDurationMicroseconds(artifactPercentileDuration(ordered, 0.99)), "p99_us")
}

func artifactPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}

func artifactDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
