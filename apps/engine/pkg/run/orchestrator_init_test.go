package run

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	configpkg "github.com/TaskForceAI/config/pkg"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	coretools "github.com/TaskForceAI/core/pkg/tools"
	infrasearch "github.com/TaskForceAI/infrastructure/search/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type initTestCache struct{}

func (initTestCache) Get(ctx context.Context, key string) (string, error) {
	return "", nil
}

func (initTestCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	return nil
}

func (initTestCache) Delete(ctx context.Context, key string) (bool, error) {
	return false, nil
}

func (initTestCache) Take(ctx context.Context, key string) (string, error) {
	return "", nil
}

func (initTestCache) Clear(ctx context.Context) error {
	return nil
}

func TestGetSharedSandboxPoolReusesUntilReset(t *testing.T) {
	resetSharedSandboxPool(context.Background())
	t.Cleanup(func() { resetSharedSandboxPool(context.Background()) })

	first := getSharedSandboxPool()
	second := getSharedSandboxPool()
	require.Same(t, first, second)

	resetSharedSandboxPool(context.Background())

	third := getSharedSandboxPool()
	require.NotSame(t, first, third)
}

func TestInitOrchestratorUsesSandboxPoolProvider(t *testing.T) {
	restore(t, &SandboxPoolProvider)
	restore(t, &WebEnvLoader)

	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	pool := coretools.NewSandboxPool()
	calls := 0
	SandboxPoolProvider = func() *coretools.SandboxPool {
		calls++
		return pool
	}

	orch := initOrchestrator(OrchestratorInitInput{
		Config: coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{Model: "gpt-4"},
		},
		UserID:               1,
		CodeExecutionEnabled: true,
	})

	require.NotNil(t, orch)
	assert.Equal(t, 1, calls)
}

func TestInitOrchestratorWithCache(t *testing.T) {
	restore(t, &WebEnvLoader)
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	orch := initOrchestrator(OrchestratorInitInput{
		Config: coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{Model: "gpt-4"},
		},
		UserID: 1,
		Cache:  initTestCache{},
	})
	require.NotNil(t, orch)
}

func TestInitOrchestratorIncludesReasoningEffortInCacheNamespace(t *testing.T) {
	restore(t, &WebEnvLoader)
	WebEnvLoader = func(configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	orch := initOrchestrator(OrchestratorInitInput{
		Config: coreconfig.Config{
			Agent:   coreconfig.AgentConfig{ReasoningEffort: "high"},
			Gateway: coreconfig.GatewayConfig{Model: "gpt-4"},
		},
		UserID: 1,
		Cache:  initTestCache{},
	})

	require.NotNil(t, orch)
}

func TestInitOrchestratorSearchGatewayError(t *testing.T) {
	restore(t, &WebEnvLoader)
	restore(t, &newSearchGateway)
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{BraveSearchAPIKey: "test-key"}, nil
	}
	newSearchGateway = func(infrasearch.BraveConfig) (*infrasearch.SearchGateway, error) {
		return nil, errors.New("search unavailable")
	}

	orch := initOrchestrator(OrchestratorInitInput{
		Config: coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{Model: "gpt-4"},
		},
		UserID:           1,
		WebSearchEnabled: true,
	})
	require.NotNil(t, orch)
}

func TestCoreSearchGatewayAdapterSearch(t *testing.T) {
	noKeyGateway, err := infrasearch.NewSearchGateway(infrasearch.BraveConfig{})
	require.NoError(t, err)
	_, err = (coreSearchGatewayAdapter{gateway: noKeyGateway}).Search(context.Background(), coretools.SearchParams{
		OriginalQuery: "go",
		MaxResults:    1,
	})
	require.Error(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/res/v1/web/search", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, writeErr := w.Write([]byte(`{
			"type":"search",
			"web":{
				"type":"search",
				"results":[{
					"title":"Go",
					"url":"https://go.dev/",
					"description":"The Go programming language."
				}]
			}
		}`))
		assert.NoError(t, writeErr)
	}))
	defer server.Close()

	gateway, err := infrasearch.NewSearchGateway(infrasearch.BraveConfig{
		APIKey:   "test-api-key",
		Endpoint: server.URL + "/res/v1/web/search",
	})
	require.NoError(t, err)

	got, err := (coreSearchGatewayAdapter{gateway: gateway}).Search(context.Background(), coretools.SearchParams{
		OriginalQuery: "go",
		MaxResults:    1,
	})
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Len(t, got.Results, 1)
	assert.Equal(t, "Go", got.Results[0].Title)
	assert.Equal(t, "https://go.dev/", got.Results[0].URL)
}

func TestResetDepsRestoresSandboxPoolProvider(t *testing.T) {
	SandboxPoolProvider = func() *coretools.SandboxPool {
		return nil
	}

	ResetDeps()
	t.Cleanup(func() { resetSharedSandboxPool(context.Background()) })

	require.NotNil(t, SandboxPoolProvider())
}
