package handler

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDownloadBlobTokenProvider_GetToken(t *testing.T) {
	provider := &downloadBlobTokenProvider{token: "blob-token"}
	token, err := provider.GetToken("", "")
	require.NoError(t, err)
	assert.Equal(t, "blob-token", token)
}

func TestDownloadBlobArtifactStore_DefaultClient(t *testing.T) {
	// With no injected client, the store constructs the real vercel blob client.
	// A canceled context makes the subsequent List fail fast without a live
	// network round-trip, exercising the default-client fallback.
	store := downloadBlobArtifactStore{token: "token"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := store.ListDownloadArtifacts(ctx, "desktop/macos/")
	require.Error(t, err)
}

func TestStatusBlobPublisher_DefaultClient(t *testing.T) {
	publisher := statusBlobPublisher{token: "token"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := publisher.PublishStatus(ctx, platform.StatusResponse{})
	require.Error(t, err)
}
