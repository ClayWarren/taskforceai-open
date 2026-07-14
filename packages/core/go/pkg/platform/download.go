package platform

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

var (
	ErrInvalidDownloadRequest     = errors.New("invalid download request")
	ErrDownloadNotFound           = errors.New("download not found")
	ErrDownloadServiceUnavailable = errors.New("download service unavailable")
)

type DownloadLogInput struct {
	Product       string  `json:"product"`
	Platform      string  `json:"platform"`
	Version       string  `json:"version"`
	UserAgent     *string `json:"userAgent"`
	IPAddressHash *string `json:"ipAddressHash"`
	Referrer      string  `json:"referrer"`
}

var DownloadMapping = map[string]map[string]struct{ Pattern, ContentType, Filename string }{
	"desktop": {
		"macos":             {"desktop/macos/TaskForceAI-*-x64.dmg", "application/x-apple-diskimage", "TaskForceAI-x64.dmg"},
		"macos-arm64":       {"desktop/macos/TaskForceAI-*-arm64.dmg", "application/x-apple-diskimage", "TaskForceAI-arm64.dmg"},
		"macos-x64":         {"desktop/macos/TaskForceAI-*-x64.dmg", "application/x-apple-diskimage", "TaskForceAI-x64.dmg"},
		"windows":           {"desktop/windows/TaskForceAI-*-x64.exe", "application/x-msdownload", "TaskForceAI-Setup-x64.exe"},
		"windows-x64":       {"desktop/windows/TaskForceAI-*-x64.exe", "application/x-msdownload", "TaskForceAI-Setup-x64.exe"},
		"windows-arm64":     {"desktop/windows/TaskForceAI-*-arm64.exe", "application/x-msdownload", "TaskForceAI-Setup-arm64.exe"},
		"windows-x64-msi":   {"desktop/windows/TaskForceAI-*-x64.msi", "application/x-msi", "TaskForceAI-x64.msi"},
		"windows-arm64-msi": {"desktop/windows/TaskForceAI-*-arm64.msi", "application/x-msi", "TaskForceAI-arm64.msi"},
		"linux":             {"desktop/linux/TaskForceAI-*.AppImage", "application/octet-stream", "TaskForceAI.AppImage"},
		"linux-deb":         {"desktop/linux/TaskForceAI-*.deb", "application/vnd.debian.binary-package", "TaskForceAI.deb"},
		"linux-rpm":         {"desktop/linux/TaskForceAI-*.rpm", "application/x-rpm", "TaskForceAI.rpm"},
		"linux-arm64":       {"desktop/linux-arm64/TaskForceAI-*.AppImage", "application/octet-stream", "TaskForceAI-arm64.AppImage"},
		"linux-arm64-deb":   {"desktop/linux-arm64/TaskForceAI-*.deb", "application/vnd.debian.binary-package", "TaskForceAI-arm64.deb"},
		"linux-arm64-rpm":   {"desktop/linux-arm64/TaskForceAI-*.rpm", "application/x-rpm", "TaskForceAI-arm64.rpm"},
	},
	"cli": {
		"macos":         {"cli/macos/taskforceai-*-darwin-amd64", "application/octet-stream", "taskforceai"},
		"macos-arm64":   {"cli/macos/taskforceai-*-darwin-arm64", "application/octet-stream", "taskforceai"},
		"linux":         {"cli/linux/taskforceai-*-linux-amd64", "application/octet-stream", "taskforceai"},
		"linux-arm64":   {"cli/linux/taskforceai-*-linux-arm64", "application/octet-stream", "taskforceai"},
		"windows":       {"cli/windows/taskforceai-*-windows-amd64.exe", "application/x-msdownload", "taskforceai.exe"},
		"windows-arm64": {"cli/windows/taskforceai-*-windows-arm64.exe", "application/x-msdownload", "taskforceai.exe"},
	},
	"mobile": {
		"ios":     {"mobile/ios/TaskForceAI-*.ipa", "application/octet-stream", "TaskForceAI.ipa"},
		"android": {"mobile/android/TaskForceAI-*.apk", "application/vnd.android.package-archive", "TaskForceAI.apk"},
	},
}

type DownloadService struct {
	store     DownloadStore
	artifacts DownloadArtifactStore
}

type DownloadStore interface {
	RecordDownload(ctx context.Context, input RecordDownloadInput) error
}

type RecordDownloadInput struct {
	Product       string
	Platform      string
	Version       string
	UserAgent     *string
	IPAddressHash *string
	Referrer      *string
}

type DownloadArtifactStore interface {
	ListDownloadArtifacts(ctx context.Context, prefix string) ([]DownloadArtifact, error)
}

type DownloadArtifact struct {
	PathName   string
	URL        string
	UploadedAt time.Time
}

func NewDownloadService(store DownloadStore, artifacts DownloadArtifactStore) *DownloadService {
	return &DownloadService{store: store, artifacts: artifacts}
}

func (s *DownloadService) ResolveDownload(ctx context.Context, product, platform, version string) (string, error) {
	m, ok := DownloadMapping[product][platform]
	if !ok {
		return "", fmt.Errorf("%w: invalid product/platform", ErrInvalidDownloadRequest)
	}

	if s.artifacts == nil {
		return "", fmt.Errorf("%w: download artifact source is not configured", ErrDownloadServiceUnavailable)
	}

	prefix := m.Pattern
	suffix := ""
	if starIdx := strings.Index(prefix, "*"); starIdx != -1 {
		suffix = prefix[starIdx+1:]
		prefix = prefix[:starIdx]
	}

	blobs, err := s.artifacts.ListDownloadArtifacts(ctx, prefix)
	if err != nil {
		return "", fmt.Errorf("%w: failed to list download artifacts: %w", ErrDownloadServiceUnavailable, err)
	}

	if len(blobs) == 0 {
		return "", fmt.Errorf("%w: no blobs found", ErrDownloadNotFound)
	}

	selected := selectBlob(blobs, version, suffix)
	if selected == nil {
		return "", fmt.Errorf("%w: version not found", ErrDownloadNotFound)
	}

	return selected.URL, nil
}

func selectBlob(blobs []DownloadArtifact, version, suffix string) *DownloadArtifact {
	var selected *DownloadArtifact

	if version == "latest" {
		for _, b := range blobs {
			if suffix != "" && !strings.HasSuffix(b.PathName, suffix) {
				continue
			}
			if selected == nil || b.UploadedAt.After(selected.UploadedAt) {
				// Avoid taking address of loop variable
				current := b
				selected = &current
			}
		}
		return selected
	}

	for _, b := range blobs {
		if artifactMatchesVersion(b.PathName, version, suffix) {
			selected = &b
			break
		}
	}
	return selected
}

func artifactMatchesVersion(path, version, suffix string) bool {
	if version == "" || (suffix != "" && !strings.HasSuffix(path, suffix)) {
		return false
	}
	filename := filepath.Base(path)
	if suffix != "" {
		filename = strings.TrimSuffix(filename, suffix)
	}
	return strings.HasSuffix(filename, "-"+version)
}

func (s *DownloadService) RecordDownload(ctx context.Context, data DownloadLogInput) error {
	return s.store.RecordDownload(ctx, RecordDownloadInput{
		Product:       data.Product,
		Platform:      data.Platform,
		Version:       data.Version,
		UserAgent:     data.UserAgent,
		IPAddressHash: data.IPAddressHash,
		Referrer:      &data.Referrer,
	})
}
