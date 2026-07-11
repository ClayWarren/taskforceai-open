package get

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/core/pkg/platform"
)

type mockDownloadService struct {
	resolveFunc func(ctx context.Context, product, platform, version string) (string, error)
	recordFunc  func(ctx context.Context, data platform.DownloadLogInput) error
}

func (m *mockDownloadService) ResolveDownload(ctx context.Context, product, platform, version string) (string, error) {
	return m.resolveFunc(ctx, product, platform, version)
}

func (m *mockDownloadService) RecordDownload(ctx context.Context, data platform.DownloadLogInput) error {
	if m.recordFunc != nil {
		return m.recordFunc(ctx, data)
	}
	return nil
}

func setupDownloadRouter(service DownloadService) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, service)
	return r
}

func TestDownloadHandler_Success(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "secret")

	var captured platform.DownloadLogInput
	service := &mockDownloadService{
		resolveFunc: func(ctx context.Context, product, platformName, version string) (string, error) {
			return "https://example.com/file", nil
		},
		recordFunc: func(ctx context.Context, data platform.DownloadLogInput) error {
			captured = data
			return nil
		},
	}

	router := setupDownloadRouter(service)
	req := httptest.NewRequest(http.MethodGet, "/api/download/cli/macos/latest", nil)
	req.Header.Set("User-Agent", "test-agent")
	req.Header.Set("X-Forwarded-For", "203.0.113.1")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusFound, resp.Code)
	assert.Equal(t, "https://example.com/file", resp.Header().Get("Location"))

	expectedHash := sha256.Sum256([]byte("203.0.113.1:secret"))
	expectedHashHex := hex.EncodeToString(expectedHash[:])
	require.NotNil(t, captured.IPAddressHash)
	assert.Equal(t, expectedHashHex, *captured.IPAddressHash)
	assert.Equal(t, "cli", captured.Product)
	assert.Equal(t, "macos", captured.Platform)
	assert.Equal(t, "latest", captured.Version)
}

func TestDownloadHandler_InvalidRequest(t *testing.T) {
	service := &mockDownloadService{
		resolveFunc: func(ctx context.Context, product, platformName, version string) (string, error) {
			return "", errors.Join(platform.ErrInvalidDownloadRequest, errors.New("invalid product/platform"))
		},
	}

	router := setupDownloadRouter(service)
	req := httptest.NewRequest(http.MethodGet, "/api/download/cli/bad/latest", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestDownloadHandler_NotFound(t *testing.T) {
	service := &mockDownloadService{
		resolveFunc: func(ctx context.Context, product, platformName, version string) (string, error) {
			return "", errors.Join(platform.ErrDownloadNotFound, errors.New("missing"))
		},
	}

	router := setupDownloadRouter(service)
	req := httptest.NewRequest(http.MethodGet, "/api/download/cli/macos/latest", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestDownloadHandler_ServiceUnavailable(t *testing.T) {
	service := &mockDownloadService{
		resolveFunc: func(ctx context.Context, product, platformName, version string) (string, error) {
			return "", errors.Join(platform.ErrDownloadServiceUnavailable, errors.New("blob service unavailable"))
		},
	}

	router := setupDownloadRouter(service)
	req := httptest.NewRequest(http.MethodGet, "/api/download/cli/macos/latest", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDownloadHandler_DefaultError(t *testing.T) {
	service := &mockDownloadService{
		resolveFunc: func(ctx context.Context, product, platformName, version string) (string, error) {
			return "", errors.New("unexpected")
		},
	}

	router := setupDownloadRouter(service)
	req := httptest.NewRequest(http.MethodGet, "/api/download/cli/macos/latest", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDownloadHandler_RecordFailureStillRedirects(t *testing.T) {
	var captured platform.DownloadLogInput
	service := &mockDownloadService{
		resolveFunc: func(ctx context.Context, product, platformName, version string) (string, error) {
			return "https://example.com/file", nil
		},
		recordFunc: func(ctx context.Context, data platform.DownloadLogInput) error {
			captured = data
			return errors.New("analytics down")
		},
	}

	router := setupDownloadRouter(service)
	req := httptest.NewRequest(http.MethodGet, "/api/download/cli/linux/1.0.0", nil)
	req.Header.Set("User-Agent", "agent")
	req.Header.Set("Referer", "https://example.com/source")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusFound, resp.Code)
	assert.Equal(t, "https://example.com/file", resp.Header().Get("Location"))
	assert.Nil(t, captured.IPAddressHash)
	assert.Equal(t, "https://example.com/source", captured.Referrer)
}
