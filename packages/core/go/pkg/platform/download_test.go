package platform

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type downloadStoreStub struct {
	recordDownloadFunc func(ctx context.Context, input RecordDownloadInput) error
}

func (s downloadStoreStub) RecordDownload(ctx context.Context, input RecordDownloadInput) error {
	return s.recordDownloadFunc(ctx, input)
}

type downloadArtifactStoreStub struct {
	artifacts []DownloadArtifact
	err       error
	prefixes  []string
}

func (s *downloadArtifactStoreStub) ListDownloadArtifacts(_ context.Context, prefix string) ([]DownloadArtifact, error) {
	s.prefixes = append(s.prefixes, prefix)
	if s.err != nil {
		return nil, s.err
	}
	return s.artifacts, nil
}

func TestDownloadPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("generic desktop macos mapping is x64 specific", func(t *testing.T) {
		mapping := DownloadMapping["desktop"]["macos"]
		assert.Equal(t, "desktop/macos/TaskForceAI-*-x64.dmg", mapping.Pattern)
		assert.Equal(t, "TaskForceAI-x64.dmg", mapping.Filename)
	})

	t.Run("desktop linux arm64 mappings use isolated blob prefixes", func(t *testing.T) {
		assert.Equal(t, "desktop/linux/TaskForceAI-*.AppImage", DownloadMapping["desktop"]["linux"].Pattern)
		assert.Equal(t, "desktop/linux-arm64/TaskForceAI-*.AppImage", DownloadMapping["desktop"]["linux-arm64"].Pattern)
		assert.Equal(t, "desktop/linux-arm64/TaskForceAI-*.deb", DownloadMapping["desktop"]["linux-arm64-deb"].Pattern)
		assert.Equal(t, "desktop/linux-arm64/TaskForceAI-*.rpm", DownloadMapping["desktop"]["linux-arm64-rpm"].Pattern)
	})

	t.Run("select blob filters suffix for explicit versions", func(t *testing.T) {
		blobs := []DownloadArtifact{
			{PathName: "desktop/macos/TaskForceAI-1.0.0.dmg", UploadedAt: time.Now()},
			{PathName: "desktop/macos/TaskForceAI-1.0.0.pkg", UploadedAt: time.Now()},
		}
		selected := selectBlob(blobs, "1.0.0", ".dmg")
		if selected == nil || selected.PathName != "desktop/macos/TaskForceAI-1.0.0.dmg" {
			t.Fatalf("expected dmg blob, got %#v", selected)
		}
		assert.Nil(t, selectBlob(blobs, "9.9.9", ".dmg"))
		assert.Nil(t, selectBlob(blobs, "macos", ".dmg"))
	})

	t.Run("resolve download validates mapping and artifact source before list", func(t *testing.T) {
		svc := NewDownloadService(nil, nil)
		_, err := svc.ResolveDownload(context.Background(), "desktop", "macos", "latest")
		require.ErrorIs(t, err, ErrDownloadServiceUnavailable)

		source := &downloadArtifactStoreStub{err: errors.New("blob unavailable")}
		svc = NewDownloadService(nil, source)
		_, err = svc.ResolveDownload(context.Background(), "desktop", "macos", "latest")
		require.ErrorIs(t, err, ErrDownloadServiceUnavailable)
		assert.Contains(t, err.Error(), "blob unavailable")
	})
}

func TestDownloadService_ResolveDownload(t *testing.T) {
	svc := NewDownloadService(nil, nil)

	// Test invalid product/platform
	_, err := svc.ResolveDownload(context.Background(), "invalid", "macos", "latest")
	require.Error(t, err)
	require.ErrorIs(t, err, ErrInvalidDownloadRequest)

	// Test missing artifact source
	_, err = svc.ResolveDownload(context.Background(), "desktop", "macos", "latest")
	require.Error(t, err)
	require.ErrorIs(t, err, ErrDownloadServiceUnavailable)
	assert.Contains(t, err.Error(), "download artifact source is not configured")
}

func TestRecordDownload(t *testing.T) {
	ua := "test-agent"
	ip := "hash"

	svc := NewDownloadService(downloadStoreStub{
		recordDownloadFunc: func(ctx context.Context, input RecordDownloadInput) error {
			assert.Equal(t, "desktop", input.Product)
			assert.Equal(t, "macos", input.Platform)
			assert.Equal(t, "1.0.0", input.Version)
			require.NotNil(t, input.UserAgent)
			require.NotNil(t, input.IPAddressHash)
			require.NotNil(t, input.Referrer)
			assert.Equal(t, ua, *input.UserAgent)
			assert.Equal(t, ip, *input.IPAddressHash)
			assert.Equal(t, "ref", *input.Referrer)
			return nil
		},
	}, nil)

	err := svc.RecordDownload(context.Background(), DownloadLogInput{
		Product:       "desktop",
		Platform:      "macos",
		Version:       "1.0.0",
		UserAgent:     &ua,
		IPAddressHash: &ip,
		Referrer:      "ref",
	})
	assert.NoError(t, err)
}

func TestSelectBlob(t *testing.T) {
	now := time.Now()
	blobs := []DownloadArtifact{
		{PathName: "TaskForceAI-1.0.0.dmg", UploadedAt: now.Add(-time.Hour)},
		{PathName: "TaskForceAI-1.1.0.dmg", UploadedAt: now},
		{PathName: "TaskForceAI-1.0.0-mac.zip", UploadedAt: now},
	}

	// Test latest
	selected := selectBlob(blobs, "latest", ".dmg")
	require.NotNil(t, selected)
	assert.Equal(t, "TaskForceAI-1.1.0.dmg", selected.PathName)

	// Test specific version
	selected = selectBlob(blobs, "1.0.0", ".dmg")
	require.NotNil(t, selected)
	assert.Equal(t, "TaskForceAI-1.0.0.dmg", selected.PathName)

	// Test no match suffix
	selected = selectBlob(blobs, "latest", ".pkg")
	assert.Nil(t, selected)

	// Test no match version
	selected = selectBlob(blobs, "2.0.0", ".dmg")
	assert.Nil(t, selected)

	// Test substring collision (1.0.0 should not match 11.0.0)
	selected = selectBlob([]DownloadArtifact{
		{PathName: "cli/windows/taskforceai-11.0.0-windows-amd64.exe", UploadedAt: now},
		{PathName: "cli/windows/taskforceai-1.0.0-windows-amd64.exe", UploadedAt: now.Add(-time.Minute)},
	}, "1.0.0", "-windows-amd64.exe")
	require.NotNil(t, selected)
	assert.Equal(t, "cli/windows/taskforceai-1.0.0-windows-amd64.exe", selected.PathName)

	assert.Nil(t, selectBlob([]DownloadArtifact{{
		PathName: "desktop/macos/TaskForceAI-1.0.0-x64.dmg",
	}}, "x64", "-x64.dmg"))
}
