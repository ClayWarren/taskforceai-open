package platform

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlatformDownloadResolveEdges(t *testing.T) {
	_, err := NewDownloadService(nil, &downloadArtifactStoreStub{}).ResolveDownload(context.Background(), "desktop", "macos", "latest")
	require.ErrorIs(t, err, ErrDownloadNotFound)
	assert.Contains(t, err.Error(), "no blobs found")

	_, err = NewDownloadService(nil, &downloadArtifactStoreStub{
		artifacts: []DownloadArtifact{{PathName: "desktop/macos/TaskForceAI-1.0.0.pkg", UploadedAt: time.Now(), URL: "https://blob.test/pkg"}},
	}).ResolveDownload(context.Background(), "desktop", "macos", "latest")
	require.ErrorIs(t, err, ErrDownloadNotFound)
	assert.Contains(t, err.Error(), "version not found")

	source := &downloadArtifactStoreStub{
		artifacts: []DownloadArtifact{{PathName: "desktop/macos/TaskForceAI-1.0.0-x64.dmg", UploadedAt: time.Now(), URL: "https://blob.test/app.dmg"}},
	}
	url, err := NewDownloadService(nil, source).ResolveDownload(context.Background(), "desktop", "macos", "1.0.0")
	require.NoError(t, err)
	assert.Equal(t, "https://blob.test/app.dmg", url)
	assert.Equal(t, []string{"desktop/macos/TaskForceAI-"}, source.prefixes)
	assert.False(t, artifactMatchesVersion("app.dmg", "", ".dmg"))
	assert.Nil(t, selectBlob([]DownloadArtifact{{
		PathName:   "desktop/macos/TaskForceAI-1.0.0.pkg",
		UploadedAt: time.Now(),
	}}, "1.0.0", ".dmg"))
}

func TestPlatformStatusEdges(t *testing.T) {
	previousNow := statusNow
	t.Cleanup(func() {
		statusNow = previousNow
	})

	base := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	svc := NewStatusService()
	svc.cached = StatusResponse{OverallStatus: ServiceStatusDegraded}
	svc.cachedUntil = base
	calls := 0
	statusNow = func() time.Time {
		calls++
		if calls == 1 {
			return base.Add(time.Second)
		}
		return base.Add(-time.Second)
	}
	status, err := svc.GetServiceStatus(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ServiceStatusDegraded, status.OverallStatus)

	statusNow = func() time.Time {
		return base.Add(-time.Second)
	}
	status, err = svc.GetServiceStatus(context.Background())
	require.NoError(t, err)
	assert.Equal(t, ServiceStatusDegraded, status.OverallStatus)

	expected := errors.New("publish failed")
	err = NewStatusService(&statusPublisherStub{err: expected}).Publish(context.Background())
	require.ErrorIs(t, err, expected)
}

func TestPlatformGDPREdges(t *testing.T) {
	email := "test@example.com"
	svc := NewGdprService(gdprStoreStub{
		getUserByEmailFunc: func(context.Context, string) (GdprUser, error) {
			return GdprUser{}, errors.New("lookup failed")
		},
		getConversationsByUserFunc: func(context.Context, GetConversationsByUserInput) ([]GdprConversation, error) {
			return nil, nil
		},
		deleteUserFunc: func(context.Context, int32) error {
			return nil
		},
	})
	_, err := svc.FindConversationsByEmail(context.Background(), email)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "lookup failed")

	var buf bytes.Buffer
	_, _ = buf.WriteString("used")
}
