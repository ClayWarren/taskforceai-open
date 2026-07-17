package update

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/go-core/internal/handlertest"
	vercelblob "github.com/claywarren/vercel_blob"
)

type mockBlobClient struct {
	listFunc func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error)
}

func (m *mockBlobClient) List(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
	return m.listFunc(ctx, options)
}

type stubUpdateCache struct {
	getFunc func(ctx context.Context, key string) (string, error)
	setFunc func(ctx context.Context, key string, value []byte, ttl time.Duration) error
}

func (s stubUpdateCache) Get(ctx context.Context, key string) (string, error) {
	return s.getFunc(ctx, key)
}

func (s stubUpdateCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return s.setFunc(ctx, key, value, ttl)
}

func setupUpdateRouter(t *testing.T, cache ...updateCache) *chi.Mux {
	t.Helper()
	var selectedCache updateCache
	if len(cache) > 0 {
		selectedCache = cache[0]
	}
	origCache := getUpdateCache
	getUpdateCache = func() (updateCache, error) {
		return selectedCache, nil
	}
	t.Cleanup(func() { getUpdateCache = origCache })

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api)
	return r
}

func TestDesktopUpdate_MissingToken(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	router := setupUpdateRouter(t)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/desktop/update/darwin/1.0.0")
}

func TestDesktopUpdate_ListError(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return nil, io.EOF
		}}
	}
	defer func() { newBlobClient = origClient }()

	router := setupUpdateRouter(t)
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/desktop/update/darwin/1.0.0")
}

func TestDesktopUpdate_NoBlobs(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{}}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	router := setupUpdateRouter(t)
	handlertest.ServeStatus(t, router, http.StatusNotFound, http.MethodGet, "/api/desktop/update/darwin/1.0.0")
}

func TestDesktopUpdate_Success(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Date(2026, 7, 1, 12, 30, 0, 0, time.FixedZone("CDT", -5*60*60))
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/macos/TaskForceAI-1.2.3-x64.app.tar.gz", URL: "https://example.com/macos", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-1.2.3-x64.app.tar.gz.sig", URL: "https://example.com/macos.sig", UploadedAt: now},
		{PathName: "desktop/windows/TaskForceAI-1.2.3-x64.msi", URL: "https://example.com/windows", UploadedAt: now.Add(-time.Second)},
		{PathName: "desktop/windows/TaskForceAI-1.2.3-x64.msi.sig", URL: "https://example.com/windows.sig", UploadedAt: now.Add(-time.Second)},
		{PathName: "desktop/linux/TaskForceAI-1.2.3.AppImage.tar.gz", URL: "https://example.com/linux", UploadedAt: now.Add(-2 * time.Second)},
		{PathName: "desktop/linux/TaskForceAI-1.2.3.AppImage.tar.gz.sig", URL: "https://example.com/linux.sig", UploadedAt: now.Add(-2 * time.Second)},
		{PathName: "desktop/macos/TaskForceAI-1.2.2.app.tar.gz", URL: "https://example.com/old", UploadedAt: now.Add(-time.Hour)},
	}

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: blobs}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	origDo := httpDo
	requests := 0
	httpDo = func(req *http.Request) (*http.Response, error) {
		requests++
		body := io.NopCloser(strings.NewReader("signature"))
		return &http.Response{StatusCode: http.StatusOK, Body: body}, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
	var body UpdateResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "1.2.3", body.Version)
	require.Contains(t, resp.Body.String(), "darwin-x86_64")
	require.NotContains(t, resp.Body.String(), "windows-x86_64")
	require.NotContains(t, resp.Body.String(), "linux-x86_64")
	require.Contains(t, resp.Body.String(), "signature")
	require.Contains(t, resp.Body.String(), `"url":"https://example.com/macos"`)
	require.Contains(t, resp.Body.String(), `"signature":"signature"`)
	require.Equal(t, 1, requests)
}

func TestDesktopUpdate_CacheHitSkipsBlobListAndSignatureFetch(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	cache := infraredis.NewMockClient()
	cached := cachedDesktopUpdate{
		Target:    "darwin-x86_64",
		Version:   "1.2.3",
		PubDate:   "2026-06-21T18:00:00Z",
		URL:       "https://example.com/macos",
		Signature: "cached-signature",
		PathName:  "desktop/macos/TaskForceAI-1.2.3.app.tar.gz",
	}
	data, err := json.Marshal(cached)
	require.NoError(t, err)
	require.NoError(t, cache.Set(context.Background(), desktopUpdateCacheKey("darwin-x86_64"), data, time.Minute))

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			t.Fatal("blob list should not be called on cache hit")
			return nil, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		t.Fatal("signature fetch should not be called on cache hit")
		return nil, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t, cache)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
	require.Contains(t, resp.Body.String(), `"version":"1.2.3"`)
	require.Contains(t, resp.Body.String(), `"signature":"cached-signature"`)
	require.Contains(t, resp.Body.String(), `"url":"https://example.com/macos"`)
}

func TestDesktopUpdate_CacheHitCanonicalizesArtifactVersion(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	cache := infraredis.NewMockClient()
	cached := cachedDesktopUpdate{
		Target:    "darwin-aarch64",
		Version:   "0.4.16-arm64.app.tar.gz",
		PubDate:   "2026-07-01T18:00:00Z",
		URL:       "https://example.com/macos-arm64",
		Signature: "cached-signature",
		PathName:  "desktop/macos/TaskForceAI-0.4.16-arm64.app.tar.gz",
	}
	data, err := json.Marshal(cached)
	require.NoError(t, err)
	require.NoError(t, cache.Set(context.Background(), desktopUpdateCacheKey("darwin-aarch64"), data, time.Minute))

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			t.Fatal("blob list should not be called on cache hit")
			return nil, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	router := setupUpdateRouter(t, cache)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/darwin-aarch64/0.4.15")
	var response UpdateResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &response))
	assert.Equal(t, "0.4.16", response.Version)
	assert.Equal(t, "https://example.com/macos-arm64", response.Platforms["darwin-aarch64"].URL)
}

func TestDesktopUpdate_CacheHitReturnsNoContentForCurrentVersion(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	cache := infraredis.NewMockClient()
	cached := cachedDesktopUpdate{
		Target:    "darwin-x86_64",
		Version:   "1.2.3",
		URL:       "https://example.com/macos",
		PubDate:   "2026-06-21T18:00:00Z",
		Signature: "cached-signature",
	}
	data, err := json.Marshal(cached)
	require.NoError(t, err)
	require.NoError(t, cache.Set(context.Background(), desktopUpdateCacheKey("darwin-x86_64"), data, time.Minute))

	router := setupUpdateRouter(t, cache)
	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.2.3")
}

func TestDesktopUpdate_CacheHitResponseError(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	cache := infraredis.NewMockClient()
	cached := cachedDesktopUpdate{
		Target:    "darwin-x86_64",
		Version:   "bad-version",
		URL:       "https://example.com/macos",
		Signature: "cached-signature",
	}
	data, err := json.Marshal(cached)
	require.NoError(t, err)
	require.NoError(t, cache.Set(context.Background(), desktopUpdateCacheKey("darwin-x86_64"), data, time.Minute))

	router := setupUpdateRouter(t, cache)
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
}

func TestDesktopUpdate_CacheMissStoresLatestMetadata(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Date(2026, 7, 1, 12, 30, 0, 0, time.FixedZone("CDT", -5*60*60))
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/macos", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz.sig", URL: "https://example.com/macos.sig", UploadedAt: now},
	}
	cache := infraredis.NewMockClient()
	listCalls := 0

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			listCalls++
			return &vercelblob.ListBlobResult{Blobs: blobs}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		body := io.NopCloser(strings.NewReader("signature"))
		return &http.Response{StatusCode: http.StatusOK, Body: body}, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t, cache)
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
	require.Equal(t, 1, listCalls)

	raw, err := cache.Get(context.Background(), desktopUpdateCacheKey("darwin-x86_64"))
	require.NoError(t, err)
	var stored cachedDesktopUpdate
	require.NoError(t, json.Unmarshal([]byte(raw), &stored))
	assert.Equal(t, "darwin-x86_64", stored.Target)
	assert.Equal(t, "1.2.3", stored.Version)
	assert.Equal(t, "2026-07-01T17:30:00Z", stored.PubDate)
	assert.Equal(t, "https://example.com/macos", stored.URL)
	assert.Equal(t, "signature", stored.Signature)
}

func TestDesktopUpdate_NoArtifactForRequestedTarget(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Now().UTC()
	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
				{PathName: "desktop/linux/TaskForceAI-1.2.3.AppImage.tar.gz", URL: "https://example.com/linux", UploadedAt: now},
			}}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	router := setupUpdateRouter(t)
	handlertest.ServeStatus(t, router, http.StatusNotFound, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
}

func TestDesktopUpdate_LinuxArm64ArtifactsDoNotPoisonX64Updates(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Now().UTC()
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/linux/TaskForceAI-2.0.0.AppImage", URL: "https://example.com/linux-x64", UploadedAt: now},
		{PathName: "desktop/linux/TaskForceAI-2.0.0.AppImage.sig", URL: "https://example.com/linux-x64.sig", UploadedAt: now},
		{PathName: "desktop/linux-arm64/TaskForceAI-2.0.0.AppImage", URL: "https://example.com/linux-arm64", UploadedAt: now.Add(time.Minute)},
		{PathName: "desktop/linux-arm64/TaskForceAI-2.0.0.AppImage.sig", URL: "https://example.com/linux-arm64.sig", UploadedAt: now.Add(time.Minute)},
	}

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: blobs}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		body := io.NopCloser(strings.NewReader("signature for " + req.URL.String()))
		return &http.Response{StatusCode: http.StatusOK, Body: body}, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t)

	x64Resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/linux-x86_64/1.0.0")
	var x64Body UpdateResponse
	require.NoError(t, json.Unmarshal(x64Resp.Body.Bytes(), &x64Body))
	assert.Equal(t, "https://example.com/linux-x64", x64Body.URL)
	require.Contains(t, x64Body.Platforms, "linux-x86_64")
	assert.Equal(t, "https://example.com/linux-x64", x64Body.Platforms["linux-x86_64"].URL)
	assert.NotContains(t, x64Resp.Body.String(), "linux-arm64")

	arm64Resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/linux-aarch64/1.0.0")
	var arm64Body UpdateResponse
	require.NoError(t, json.Unmarshal(arm64Resp.Body.Bytes(), &arm64Body))
	assert.Equal(t, "https://example.com/linux-arm64", arm64Body.URL)
	require.Contains(t, arm64Body.Platforms, "linux-aarch64")
	assert.Equal(t, "https://example.com/linux-arm64", arm64Body.Platforms["linux-aarch64"].URL)
}

func TestDesktopUpdate_CacheHitRejectsTargetMismatchedArtifact(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	cache := infraredis.NewMockClient()
	cached := cachedDesktopUpdate{
		Target:   "linux-x86_64",
		Version:  "2.0.0",
		PubDate:  "2026-07-01T20:00:00Z",
		URL:      "https://example.com/linux-arm64",
		PathName: "desktop/linux-arm64/TaskForceAI-2.0.0.AppImage",
	}
	data, err := json.Marshal(cached)
	require.NoError(t, err)
	require.NoError(t, cache.Set(context.Background(), desktopUpdateCacheKey("linux-x86_64"), data, time.Minute))

	now := time.Now().UTC()
	listCalls := 0
	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			listCalls++
			return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
				{PathName: "desktop/linux/TaskForceAI-2.0.0.AppImage", URL: "https://example.com/linux-x64", UploadedAt: now},
				{PathName: "desktop/linux/TaskForceAI-2.0.0.AppImage.sig", URL: "https://example.com/linux-x64.sig", UploadedAt: now},
			}}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()
	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("signature"))}, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t, cache)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/linux-x86_64/1.0.0")
	require.Equal(t, 1, listCalls)
	require.Contains(t, resp.Body.String(), `"url":"https://example.com/linux-x64"`)
	require.NotContains(t, resp.Body.String(), "linux-arm64")
}

func TestLinuxArtifactPlatformRejectsUnknownArtifact(t *testing.T) {
	platform, ok := linuxArtifactPlatform("desktop/linux-unknown/TaskForceAI-2.0.0.AppImage")

	assert.False(t, ok)
	assert.Empty(t, platform)
}

func TestDesktopUpdate_CacheMissResponseError(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Now().UTC()
	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
				{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/macos", UploadedAt: now},
				{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz.sig", URL: "https://example.com/macos.sig", UploadedAt: now},
			}}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()
	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("signature"))}, nil
	}
	defer func() { httpDo = origDo }()

	origBuild := buildDesktopUpdateResponse
	buildDesktopUpdateResponse = func(target, currentVersion string, latest cachedDesktopUpdate) (*UpdateResponse, error) {
		return nil, huma.Error500InternalServerError("comparison failed")
	}
	defer func() { buildDesktopUpdateResponse = origBuild }()

	router := setupUpdateRouter(t)
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
}

func TestDesktopUpdate_PaginatesBlobList(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Now().UTC()
	pages := []vercelblob.ListBlobResult{
		{
			Blobs: []vercelblob.ListBlobResultBlob{
				{PathName: "desktop/macos/TaskForceAI-1.2.2.app.tar.gz", URL: "https://example.com/old", UploadedAt: now.Add(-time.Hour)},
			},
			Cursor:  "next",
			HasMore: true,
		},
		{
			Blobs: []vercelblob.ListBlobResultBlob{
				{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/macos", UploadedAt: now},
				{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz.sig", URL: "https://example.com/macos.sig", UploadedAt: now},
			},
		},
	}
	var cursors []string

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			cursors = append(cursors, options.Cursor)
			page := pages[0]
			pages = pages[1:]
			return &page, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		body := io.NopCloser(strings.NewReader("signature"))
		return &http.Response{StatusCode: http.StatusOK, Body: body}, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t)
	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
	require.Equal(t, []string{"", "next"}, cursors)
	require.Contains(t, resp.Body.String(), `"version":"1.2.3"`)
	require.Contains(t, resp.Body.String(), `"signature":"signature"`)
}

func TestDesktopUpdate_UnsupportedTarget(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	router := setupUpdateRouter(t)

	handlertest.ServeStatus(t, router, http.StatusNotFound, http.MethodGet, "/api/desktop/update/unknown-platform/1.0.0")
}

func TestDesktopUpdate_InvalidVersion(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	router := setupUpdateRouter(t)

	handlertest.ServeStatus(t, router, http.StatusUnprocessableEntity, http.MethodGet, "/api/desktop/update/darwin-x86_64/latest")
}

func TestDesktopUpdate_NoNewerVersion(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Now().UTC()
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/macos", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz.sig", URL: "https://example.com/macos.sig", UploadedAt: now},
	}

	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: blobs}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()
	origDo := httpDo
	httpDo = func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("signature"))}, nil
	}
	defer func() { httpDo = origDo }()

	router := setupUpdateRouter(t)
	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.2.3")
}

func TestDesktopUpdate_MissingSignatureIsUnavailable(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")

	now := time.Now().UTC()
	cache := infraredis.NewMockClient()
	origClient := newBlobClient
	newBlobClient = func(token string) blobClient {
		return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{{
				PathName:   "desktop/macos/TaskForceAI-1.2.3.app.tar.gz",
				URL:        "https://example.com/macos",
				UploadedAt: now,
			}}}, nil
		}}
	}
	defer func() { newBlobClient = origClient }()

	router := setupUpdateRouter(t, cache)
	handlertest.ServeStatus(t, router, http.StatusServiceUnavailable, http.MethodGet, "/api/desktop/update/darwin-x86_64/1.0.0")
	_, err := cache.Get(context.Background(), desktopUpdateCacheKey("darwin-x86_64"))
	require.ErrorIs(t, err, infraredis.ErrKeyNotFound)
}

func TestExtractArtifactVersion(t *testing.T) {
	version, ok := extractArtifactVersion("desktop/macos/TaskForceAI-2.1.0.app.tar.gz.sig")
	require.True(t, ok)
	assert.Equal(t, "2.1.0", version)

	version, ok = extractArtifactVersion("desktop/macos/TaskForceAI-2.1.0-arm64.app.tar.gz")
	require.True(t, ok)
	assert.Equal(t, "2.1.0", version)

	version, ok = extractArtifactVersion("desktop/windows/TaskForceAI-2.1.0-x64.msi")
	require.True(t, ok)
	assert.Equal(t, "2.1.0", version)

	version, ok = extractArtifactVersion("desktop/windows/TaskForceAI-2.1.0-x64.MSI")
	require.True(t, ok)
	assert.Equal(t, "2.1.0", version)

	version, ok = extractArtifactVersion("desktop/linux/TaskForceAI-2.1.0.AppImage")
	require.True(t, ok)
	assert.Equal(t, "2.1.0", version)

	version, ok = extractArtifactVersion("desktop/macos/TaskForceAI-2.1.0-beta.1-arm64.app.tar.gz")
	require.True(t, ok)
	assert.Equal(t, "2.1.0-beta.1", version)

	_, ok = extractArtifactVersion("desktop/macos/latest.json")
	assert.False(t, ok)
}

func TestArtifactPlatform_Aarch64Alias(t *testing.T) {
	platform, ok := artifactPlatform("desktop/macos/TaskForceAI-2.1.0-aarch64.app.tar.gz")
	require.True(t, ok)
	assert.Equal(t, "darwin-aarch64", platform)

	platform, ok = artifactPlatform("desktop/macOS/TaskForceAI-2.1.0-aarch64.app.tar.gz")
	require.True(t, ok)
	assert.Equal(t, "darwin-aarch64", platform)

	platform, ok = artifactPlatform("desktop/windows/TaskForceAI-2.1.0-arm64.msi")
	require.True(t, ok)
	assert.Equal(t, "windows-aarch64", platform)

	platform, ok = artifactPlatform("desktop/windows/TaskForceAI-2.1.0-x64.MSI")
	require.True(t, ok)
	assert.Equal(t, "windows-x86_64", platform)

	platform, ok = artifactPlatform("desktop/linux/TaskForceAI-2.1.0.AppImage")
	require.True(t, ok)
	assert.Equal(t, "linux-x86_64", platform)

	platform, ok = artifactPlatform("desktop/linux-arm64/TaskForceAI-2.1.0.AppImage")
	require.True(t, ok)
	assert.Equal(t, "linux-aarch64", platform)

	platform, ok = artifactPlatform("desktop/linux/TaskForceAI-2.1.0-arm64.AppImage")
	require.True(t, ok)
	assert.Equal(t, "linux-aarch64", platform)
}

func TestEnvTokenProvider_GetToken(t *testing.T) {
	provider := envTokenProvider{token: "token"}
	value, err := provider.GetToken("read", "path")
	require.NoError(t, err)
	assert.Equal(t, "token", value)
}

func TestDefaultFactories(t *testing.T) {
	assert.NotNil(t, newBlobClient("token"))
	_, _ = getUpdateCache()
}

func TestNormalizeUpdateTarget_Aliases(t *testing.T) {
	tests := map[string]string{
		" windows ":      "windows-x86_64", //nolint:gocritic // deliberate whitespace: exercises input trimming
		"windows-arm64":  "windows-aarch64",
		"linux":          "linux-x86_64",
		"linux-amd64":    "linux-x86_64",
		"linux-arm64":    "linux-aarch64",
		"linux-aarch64":  "linux-aarch64",
		"macos":          "darwin-x86_64",
		"macos-x64":      "darwin-x86_64",
		"macos-arm64":    "darwin-aarch64",
		"darwin-arm64":   "darwin-aarch64",
		"darwin-aarch64": "darwin-aarch64",
		"darwin-x86_64":  "darwin-x86_64",
	}

	for input, expected := range tests {
		target, ok := normalizeUpdateTarget(input)
		require.True(t, ok)
		assert.Equal(t, expected, target)
	}

	_, ok := normalizeUpdateTarget("plan9")
	assert.False(t, ok)
}

func TestCompareVersions_PreReleaseOrdering(t *testing.T) {
	tests := []struct {
		name string
		a    string
		b    string
		want int
	}{
		{name: "equal", a: "1.2.3", b: "1.2.3", want: 0},
		{name: "major", a: "2.0.0", b: "1.9.9", want: 1},
		{name: "major lower", a: "1.0.0", b: "2.0.0", want: -1},
		{name: "minor", a: "1.3.0", b: "1.2.9", want: 1},
		{name: "minor lower", a: "1.2.0", b: "1.3.0", want: -1},
		{name: "patch", a: "1.2.4", b: "1.2.3", want: 1},
		{name: "patch lower", a: "1.2.3", b: "1.2.4", want: -1},
		{name: "release after prerelease", a: "1.2.3", b: "1.2.3-beta.1", want: 1},
		{name: "prerelease before release", a: "1.2.3-beta.1", b: "1.2.3", want: -1},
		{name: "numeric prerelease", a: "1.2.3-beta.2", b: "1.2.3-beta.10", want: -1},
		{name: "numeric prerelease greater", a: "1.2.3-beta.10", b: "1.2.3-beta.2", want: 1},
		{name: "numeric before text", a: "1.2.3-1", b: "1.2.3-alpha", want: -1},
		{name: "text after numeric", a: "1.2.3-alpha", b: "1.2.3-1", want: 1},
		{name: "text lexical", a: "1.2.3-beta", b: "1.2.3-alpha", want: 1},
		{name: "text lexical lower", a: "1.2.3-alpha", b: "1.2.3-beta", want: -1},
		{name: "longer prerelease", a: "1.2.3-beta.1.1", b: "1.2.3-beta.1", want: 1},
		{name: "shorter prerelease", a: "1.2.3-beta.1", b: "1.2.3-beta.1.1", want: -1},
		{name: "matching prerelease", a: "1.2.3-beta.1", b: "1.2.3-beta.1", want: 0},
		{name: "build metadata ignored", a: "1.2.3+5", b: "1.2.3+1", want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := compareVersions(tt.a, tt.b)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}

	_, err := compareVersions("bad", "1.2.3")
	require.Error(t, err)
	_, err = compareVersions("1.2.3", "bad")
	require.Error(t, err)
	_, err = compareVersions("1.bad.3", "1.2.3")
	require.Error(t, err)
	_, err = compareVersions("1.2.bad", "1.2.3")
	require.Error(t, err)
}

func TestLatestArtifactForTarget_SkipsInvalidAndUsesUploadTimeTieBreaker(t *testing.T) {
	now := time.Now().UTC()
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/macos/latest.json", URL: "https://example.com/ignored", UploadedAt: now},
		{PathName: "desktop/linux/TaskForceAI-9.0.0.AppImage", URL: "https://example.com/linux", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-bad.app.tar.gz", URL: "https://example.com/bad", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/old", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/new", UploadedAt: now.Add(time.Minute)},
		{PathName: "desktop/macos/TaskForceAI-1.2.4-beta.1.app.tar.gz", URL: "https://example.com/prerelease", UploadedAt: now.Add(-time.Minute)},
	}

	latest, version, ok := latestArtifactForTarget(blobs, "darwin-x86_64")
	require.True(t, ok)
	assert.Equal(t, "1.2.4-beta.1", version)
	assert.Equal(t, "https://example.com/prerelease", latest.URL)

	_, _, ok = latestArtifactForTarget(blobs, "windows-x86_64")
	assert.False(t, ok)
}

func TestLatestArtifactForTarget_SkipsComparisonErrors(t *testing.T) {
	now := time.Now().UTC()
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/macos/TaskForceAI-1.2.3.app.tar.gz", URL: "https://example.com/first", UploadedAt: now},
		{PathName: "desktop/macos/TaskForceAI-1.2.4.app.tar.gz", URL: "https://example.com/ignored", UploadedAt: now.Add(time.Minute)},
	}
	origCompare := compareDesktopVersions
	compareDesktopVersions = func(a, b string) (int, error) {
		return 0, errors.New("compare failed")
	}
	defer func() { compareDesktopVersions = origCompare }()

	latest, version, ok := latestArtifactForTarget(blobs, "darwin-x86_64")

	require.True(t, ok)
	assert.Equal(t, "1.2.3", version)
	assert.Equal(t, "https://example.com/first", latest.URL)
}

func TestDesktopUpdateResponseFromLatestComparisonError(t *testing.T) {
	origCompare := compareDesktopVersions
	compareDesktopVersions = func(a, b string) (int, error) {
		return 0, errors.New("compare failed")
	}
	defer func() { compareDesktopVersions = origCompare }()

	response, err := desktopUpdateResponseFromLatest("darwin-x86_64", "1.0.0", cachedDesktopUpdate{
		Target:  "darwin-x86_64",
		Version: "1.2.3",
		URL:     "https://example.com/macos",
	})

	require.Error(t, err)
	assert.Nil(t, response)
}

func TestFetchSignature_ErrorPaths(t *testing.T) {
	origDo := httpDo
	defer func() { httpDo = origDo }()

	blobs := []vercelblob.ListBlobResultBlob{{PathName: "desktop/macos/app.tar.gz.sig", URL: "https://example.com/sig"}}

	httpDo = func(req *http.Request) (*http.Response, error) {
		return nil, io.EOF
	}
	assert.Empty(t, fetchSignature(context.Background(), "desktop/macos/app.tar.gz", blobs))

	httpDo = func(req *http.Request) (*http.Response, error) {
		return nil, nil
	}
	assert.Empty(t, fetchSignature(context.Background(), "desktop/macos/app.tar.gz", blobs))

	httpDo = func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader("nope"))}, nil
	}
	assert.Empty(t, fetchSignature(context.Background(), "desktop/macos/app.tar.gz", blobs))

	assert.Empty(t, fetchSignature(context.Background(), "desktop/macos/missing.tar.gz", blobs))
}

func TestFetchSignature_RequestCreationError(t *testing.T) {
	blobs := []vercelblob.ListBlobResultBlob{{PathName: "desktop/macos/app.tar.gz.sig", URL: "http://[::1"}}

	assert.Empty(t, fetchSignature(context.Background(), "desktop/macos/app.tar.gz", blobs))
}

func TestDesktopUpdateCacheErrorBranches(t *testing.T) {
	origCache := getUpdateCache
	origMarshal := marshalCachedDesktopUpdate
	t.Cleanup(func() {
		getUpdateCache = origCache
		marshalCachedDesktopUpdate = origMarshal
	})

	getUpdateCache = func() (updateCache, error) {
		return nil, errors.New("cache unavailable")
	}
	_, ok := loadCachedDesktopUpdate(context.Background(), "darwin-x86_64")
	assert.False(t, ok)
	storeCachedDesktopUpdate(context.Background(), cachedDesktopUpdate{Target: "darwin-x86_64"})

	getUpdateCache = func() (updateCache, error) {
		return stubUpdateCache{
			getFunc: func(context.Context, string) (string, error) {
				return "", errors.New("read failed")
			},
			setFunc: func(context.Context, string, []byte, time.Duration) error {
				return nil
			},
		}, nil
	}
	_, ok = loadCachedDesktopUpdate(context.Background(), "darwin-x86_64")
	assert.False(t, ok)

	getUpdateCache = func() (updateCache, error) {
		return stubUpdateCache{
			getFunc: func(context.Context, string) (string, error) {
				return `{"target":"darwin-x86_64","version":"1.2.3","url":"https://example.com/macos","signature":"signature","pathName":"desktop/linux/TaskForceAI-1.2.3.AppImage"}`, nil
			},
			setFunc: func(context.Context, string, []byte, time.Duration) error { return nil },
		}, nil
	}
	_, ok = loadCachedDesktopUpdate(context.Background(), "darwin-x86_64")
	assert.False(t, ok)

	getUpdateCache = func() (updateCache, error) {
		return stubUpdateCache{
			getFunc: func(context.Context, string) (string, error) {
				return "{", nil
			},
			setFunc: func(context.Context, string, []byte, time.Duration) error {
				return nil
			},
		}, nil
	}
	_, ok = loadCachedDesktopUpdate(context.Background(), "darwin-x86_64")
	assert.False(t, ok)

	getUpdateCache = func() (updateCache, error) {
		return stubUpdateCache{
			getFunc: func(context.Context, string) (string, error) {
				return `{"target":"linux-x86_64","version":"1.2.3","url":"https://example.com/linux"}`, nil
			},
			setFunc: func(context.Context, string, []byte, time.Duration) error {
				return nil
			},
		}, nil
	}
	_, ok = loadCachedDesktopUpdate(context.Background(), "darwin-x86_64")
	assert.False(t, ok)

	getUpdateCache = func() (updateCache, error) {
		return stubUpdateCache{
			getFunc: func(context.Context, string) (string, error) {
				return "", infraredis.ErrKeyNotFound
			},
			setFunc: func(context.Context, string, []byte, time.Duration) error {
				return errors.New("write failed")
			},
		}, nil
	}
	_, ok = loadCachedDesktopUpdate(context.Background(), "darwin-x86_64")
	assert.False(t, ok)
	storeCachedDesktopUpdate(context.Background(), cachedDesktopUpdate{Target: "darwin-x86_64"})

	setCalled := false
	getUpdateCache = func() (updateCache, error) {
		return stubUpdateCache{
			getFunc: func(context.Context, string) (string, error) { return "", nil },
			setFunc: func(context.Context, string, []byte, time.Duration) error {
				setCalled = true
				return nil
			},
		}, nil
	}
	marshalCachedDesktopUpdate = func(any) ([]byte, error) {
		return nil, errors.New("encode failed")
	}
	storeCachedDesktopUpdate(context.Background(), cachedDesktopUpdate{Target: "darwin-x86_64"})
	assert.False(t, setCalled)
}

func TestDefaultDesktopUpdateHTTPClient(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	require.NoError(t, err)
	resp, err := httpDo(req)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, resp.Body.Close()) })
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
}
