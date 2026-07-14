package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	contractspkg "github.com/TaskForceAI/contracts/pkg"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

func setupCoreTestRouter() *chi.Mux {
	return setupCoreTestRouterWithCheck(nil)
}

func setupCoreTestRouterWithCheck(checkDatabase func(context.Context) error) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, checkDatabase)
	return r
}

func authenticatedCoreHealthRequest() *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep=true", nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 42})
	return req.WithContext(ctx)
}

func TestHealthHandler_ShallowIsPublicAndDoesNotProbeDependencies(t *testing.T) {
	called := false
	router := setupCoreTestRouterWithCheck(func(context.Context) error {
		called = true
		return nil
	})

	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/health")
	assert.False(t, called)
}

func TestHealthHandler_DeepRequiresAuthentication(t *testing.T) {
	router := setupCoreTestRouterWithCheck(func(context.Context) error { return nil })
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep=true", nil)
	resp := httptest.NewRecorder()

	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestHealthHandler_DegradedWhenAuthMisconfigured(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_SECRET", "short")

	router := setupCoreTestRouter()

	req := authenticatedCoreHealthRequest()
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)

	var body map[string]any
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	assert.Contains(t, body["detail"], "auth service configuration error")
}

func TestHealthHandler_AuthHealthyWhenSecretSet(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")

	router := setupCoreTestRouter()

	req := authenticatedCoreHealthRequest()
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var body HealthStatus
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)

	assert.Equal(t, "degraded", body.Status)
	require.Contains(t, body.Services, "auth")
	assert.Equal(t, "connected", body.Services["auth"].Status)
}

func TestHealthHandler_OperationalWhenDatabaseCheckSucceeds(t *testing.T) {
	t.Setenv("AUTH_SECRET", "abcdefghijklmnopqrstuvwxyz123456")

	router := setupCoreTestRouterWithCheck(func(context.Context) error {
		return nil
	})

	req := authenticatedCoreHealthRequest()
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)

	var body HealthStatus
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "operational", body.Status)
	assert.Equal(t, "connected", body.Services["database"].Status)
}

func TestModelsHandler_UsesConfiguredModels(t *testing.T) {
	router := setupCoreTestRouter()

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/models")

	var body contractspkg.ModelSelectorResponse
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)

	assert.True(t, body.Enabled)
	assert.NotEmpty(t, body.DefaultModelID)
	require.NotEmpty(t, body.Options)
	assertModelOptionsInclude(t, body.Options,
		"meta/muse-spark-1.1",
		"openai/gpt-5.6-sol",
		"openai/gpt-5.6-terra",
		"openai/gpt-5.6-luna",
		"anthropic/claude-sonnet-5",
		"anthropic/claude-opus-4.8",
		"anthropic/claude-haiku-4.5",
		"google/gemini-3.5-flash",
		"google/gemini-3.1-flash-lite",
	)

	seenDefault := false
	for _, opt := range body.Options {
		require.NotEmpty(t, opt.ID)
		if opt.ID == body.DefaultModelID {
			assert.Equal(t, "Default", opt.Badge)
			seenDefault = true
		} else {
			assert.Equal(t, "Available", opt.Badge)
		}
	}
	assert.True(t, seenDefault)
}

func TestModelsHandler_UsesFallbackWhenConfigHasNoModels(t *testing.T) {
	tempDir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(tempDir, "config"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(tempDir, "config", "config.yaml"), []byte("models:\n  default: \"\"\n"), 0o644))
	t.Chdir(tempDir)

	router := setupCoreTestRouter()

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/models")

	var body contractspkg.ModelSelectorResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, fallbackModels.DefaultModelID, body.DefaultModelID)
	assert.NotEmpty(t, body.Options)
	assertModelOptionsInclude(t, body.Options,
		"meta/muse-spark-1.1",
		"openai/gpt-5.6-sol",
		"openai/gpt-5.6-terra",
		"openai/gpt-5.6-luna",
		"anthropic/claude-sonnet-5",
		"anthropic/claude-opus-4.8",
		"anthropic/claude-haiku-4.5",
		"google/gemini-3.5-flash",
		"google/gemini-3.1-flash-lite",
	)
}

func TestLoadModelSelectorConfigReturnsFalseWhenOptionsEmpty(t *testing.T) {
	tempDir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(tempDir, "config"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(tempDir, "config", "config.yaml"), []byte("models:\n  default: \"\"\n"), 0o644))
	t.Chdir(tempDir)

	cfg, ok := loadModelSelectorConfig()

	assert.False(t, ok)
	assert.Empty(t, cfg.Models.Options)
}

func TestFallbackModelsResponseNormalizesDefaultBadge(t *testing.T) {
	resp := fallbackModelsResponse()

	require.NotNil(t, resp)
	assert.True(t, resp.Body.Enabled)
	require.NotEmpty(t, resp.Body.DefaultModelID)
	require.NotEmpty(t, resp.Body.Options)
	assertModelOptionsInclude(t, resp.Body.Options,
		"meta/muse-spark-1.1",
		"openai/gpt-5.6-sol",
		"openai/gpt-5.6-terra",
		"openai/gpt-5.6-luna",
		"anthropic/claude-sonnet-5",
		"anthropic/claude-opus-4.8",
		"anthropic/claude-haiku-4.5",
		"google/gemini-3.5-flash",
		"google/gemini-3.1-flash-lite",
	)
	for _, option := range resp.Body.Options {
		if option.ID == resp.Body.DefaultModelID {
			assert.Equal(t, "Default", option.Badge)
			continue
		}
		assert.Equal(t, "Available", option.Badge)
	}
	assert.NotSame(t, &fallbackModels.Options[0], &resp.Body.Options[0])
}

func TestFallbackModelsResponseIsSafeForConcurrentRequests(t *testing.T) {
	var wg sync.WaitGroup
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := fallbackModelsResponse()
			assert.NotEmpty(t, resp.Body.Options)
		}()
	}
	wg.Wait()
}

func assertModelOptionsInclude(t *testing.T, options []contractspkg.ModelOptionSummary, expectedIDs ...string) {
	t.Helper()

	seen := make(map[string]struct{}, len(options))
	for _, option := range options {
		seen[option.ID] = struct{}{}
	}
	for _, expectedID := range expectedIDs {
		assert.Contains(t, seen, expectedID)
	}
}
