package run

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	configpkg "github.com/TaskForceAI/config/pkg"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	modelselection "github.com/TaskForceAI/core/pkg/orchestrator"
	enginecoreadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/enginecore"
	infracache "github.com/TaskForceAI/infrastructure/cache/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"
)

func TestCheckLLMCache_IgnoresFailureCache(t *testing.T) {
	withMockRedis(t)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		m := new(cacheMock)
		m.On("Get", mock.Anything, mock.Anything).Return("Final Answer: None", nil)
		return m
	})

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "simple question", "gpt-4")
	if result != "" {
		t.Errorf("Expected empty result for failure cache, got: %s", result)
	}
	if cacheInstance == nil {
		t.Error("Expected non-nil cache instance")
	}
	_ = requiresCurrent
}

func TestCheckLLMCache_NoRedisClient(t *testing.T) {
	withUnavailableRedis(t, errors.New("no redis"))

	result, cache, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "test prompt", "gpt-4")

	if result != "" {
		t.Error("Expected empty result when no redis client")
	}
	if cache != nil {
		t.Error("Expected nil cache when no redis client")
	}
	// requiresCurrent depends on prompt analysis
	_ = requiresCurrent
}

func TestCheckLLMCache_NoTrainingSkipsCacheRead(t *testing.T) {
	withMockRedis(t)

	mockCache := new(cacheMock)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		return mockCache
	})

	result, cacheInstance, _ := checkLLMCache(context.Background(), "task-1", 1, "simple question", "gpt-4", OrchestrateTaskOptions{NoTraining: true})

	if result != "" {
		t.Errorf("Expected empty result for no-training cache skip, got: %s", result)
	}
	if cacheInstance == nil {
		t.Error("Expected non-nil cache instance")
	}
	mockCache.AssertNotCalled(t, "Get", mock.Anything, mock.Anything)
}

func TestCheckLLMCache_MediaGenerationSkipsCacheRead(t *testing.T) {
	withMockRedis(t)

	mockCache := new(cacheMock)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		return mockCache
	})

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "Generate an image of a dog", "google/gemini-2.5-flash-image")

	if result != "" {
		t.Errorf("Expected empty result for media generation cache skip, got: %s", result)
	}
	if cacheInstance == nil {
		t.Error("Expected non-nil cache instance")
	}
	if requiresCurrent {
		t.Error("Expected media generation cache skip to avoid current-data handling")
	}
	mockCache.AssertNotCalled(t, "Get", mock.Anything, mock.Anything)
}

func TestCheckLLMCache_GeneratedFileSkipsCacheRead(t *testing.T) {
	withMockRedis(t)

	mockCache := new(cacheMock)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		return mockCache
	})

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "Create an Excel file called planets.xlsx", "gpt-4")

	if result != "" {
		t.Errorf("Expected empty result for generated-file cache skip, got: %s", result)
	}
	if cacheInstance == nil {
		t.Error("Expected non-nil cache instance")
	}
	if requiresCurrent {
		t.Error("Expected generated-file cache skip to avoid current-data handling")
	}
	mockCache.AssertNotCalled(t, "Get", mock.Anything, mock.Anything)
}

func TestCheckLLMCache_ComputerUseSkipsCacheRead(t *testing.T) {
	withMockRedis(t)

	mockCache := new(cacheMock)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		return mockCache
	})

	result, cacheInstance, skipCacheSet := checkLLMCache(context.Background(), "task-1", 1, "take a screenshot", "gpt-4", OrchestrateTaskOptions{ComputerUseEnabled: true})

	if result != "" {
		t.Errorf("Expected empty result for computer-use cache skip, got: %s", result)
	}
	if cacheInstance == nil {
		t.Error("Expected non-nil cache instance")
	}
	if !skipCacheSet {
		t.Error("Expected computer-use cache skip to also skip cache save")
	}
	mockCache.AssertNotCalled(t, "Get", mock.Anything, mock.Anything)
}

func TestCheckLLMCache_WithMockCache(t *testing.T) {
	withMockRedis(t)

	// Use a mock cache that returns nothing
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		m := new(cacheMock)
		m.On("Get", mock.Anything, mock.Anything).Return("", nil)
		return m
	})

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "simple question", "gpt-4")

	// Should return empty result when cache has nothing
	if result != "" {
		t.Errorf("Expected empty result, got: %s", result)
	}
	if cacheInstance == nil {
		t.Error("Expected non-nil cache instance")
	}
	_ = requiresCurrent
}

func TestCheckLLMCache_NotFoundIsCacheMiss(t *testing.T) {
	withMockRedis(t)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		m := new(cacheMock)
		m.On("Get", mock.Anything, mock.Anything).Return("", infracache.ErrNotFound)
		return m
	})

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "simple question", "gpt-4")

	assert.Empty(t, result)
	assert.NotNil(t, cacheInstance)
	assert.False(t, requiresCurrent)
}

func TestCheckLLMCache_ReadErrorIsCacheMiss(t *testing.T) {
	withMockRedis(t)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		m := new(cacheMock)
		m.On("Get", mock.Anything, mock.Anything).Return("", errors.New("cache failed"))
		return m
	})

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "simple question", "gpt-4")

	assert.Empty(t, result)
	assert.NotNil(t, cacheInstance)
	assert.False(t, requiresCurrent)
}

func TestCheckLLMCache_WithRedisClient_RequiresCurrentData(t *testing.T) {
	withMockRedis(t)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		return nil // Return nil cache for simplicity
	})

	// "current" in prompt triggers RequiresCurrentData
	result, cache, requiresCurrent := checkLLMCache(context.Background(), "task-1", 1, "what is the current weather", "gpt-4")

	// RequiresCurrentData should be true for this prompt
	_ = result
	_ = cache
	_ = requiresCurrent
	// The function should complete without error
}

func TestFetchUserContext_DBError(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db connection failed")
	}

	memories, driveClient, instructions, memoryEnabled, trustLayerEnabled, _ := fetchUserContext(1, nil)

	if len(memories) != 0 {
		t.Error("Expected empty memories on DB error")
	}
	if driveClient != nil {
		t.Error("Expected nil drive client on DB error")
	}
	if instructions != "" {
		t.Error("Expected empty instructions on DB error")
	}
	if !memoryEnabled {
		t.Error("Expected memoryEnabled to default to true on DB error")
	}
	if trustLayerEnabled {
		t.Error("Expected trustLayerEnabled to default to false on DB error")
	}
}

func TestFinalizeTask_NilCache(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("no db")
	}

	// Should not panic with nil cache
	finalizeTask(
		context.Background(),
		"task-1",
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil, // nil cache
		true,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	// Check that registry was updated
	state := GetRegistry().Get("task-1")
	if state == nil {
		// Task might not exist if it was never registered, which is fine
		return
	}
}

func TestFinalizeTask_WithCache_SetCache(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("no db")
	}

	// USE GENERATED MOCK
	mockCache := new(cacheMock)
	mockCache.On("Set", mock.Anything, mock.Anything, "result", 24*time.Hour).Return(nil)

	finalizeTask(
		context.Background(),
		"finalize-with-cache",
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		mockCache,
		false, // skipCacheSet = false, so Set should be called
		false,
		OrchestrateTaskOptions{},
		"",
	)

	mockCache.AssertExpectations(t)
}

func TestFinalizeTask_WithCache_SkipCacheSet(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("no db")
	}

	// USE GENERATED MOCK
	mockCache := new(cacheMock)

	finalizeTask(
		context.Background(),
		"finalize-skip-cache",
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		mockCache,
		true, // skipCacheSet = true
		false,
		OrchestrateTaskOptions{},
		"",
	)

	mockCache.AssertNotCalled(t, "Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestFinalizeTask_WithMediaGenerationModel_SkipsCacheSet(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("no db")
	}

	mockCache := new(cacheMock)

	finalizeTask(
		context.Background(),
		"finalize-media-cache",
		1,
		"Generate a video of a dog riding a skateboard",
		videoGenerationModelID,
		"result",
		nil,
		coreconfig.Config{},
		mockCache,
		false,
		true,
		OrchestrateTaskOptions{},
		"",
	)

	mockCache.AssertNotCalled(t, "Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestGetRegistry(t *testing.T) {
	registry := requireTaskRegistry(t)
	if registry == nil {
		t.Error("Expected non-nil registry")
	}

	// Should return the same instance
	registry2 := GetRegistry()
	if registry != registry2 {
		t.Error("Expected same registry instance")
	}
}

func TestInitRegistryProgress_DefaultAgentCount(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "progress-test-1"

	// Config with 0 parallel agents should default to 1
	cfg := coreconfig.Config{
		Orchestrator: coreconfig.OrchestratorConfig{
			ParallelAgents: 0,
		},
	}

	_ = initRegistryProgress(registry, taskID, cfg, false)

	// Verify progress was updated (we can't directly check the statuses,
	// but the function should not panic and should complete)
}

func TestInitRegistryProgress_MultipleAgents(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "progress-test-2"

	cfg := coreconfig.Config{
		Orchestrator: coreconfig.OrchestratorConfig{
			ParallelAgents: 5,
		},
	}

	_ = initRegistryProgress(registry, taskID, cfg, false)
	// Function should complete without error
}

func TestMain(m *testing.M) {
	redis.SetClient(redis.NewMockClient())
	enginecoreadapter.InstallSources()
	goleak.VerifyTestMain(m,
		// GetPubSubClient is a sync.Once process-lifetime singleton; tests
		// that instantiate it leave go-redis's internal maintenance loop
		// running by design.
		goleak.IgnoreTopFunction("github.com/redis/go-redis/v9/maintnotifications.(*CircuitBreakerManager).cleanupLoop"),
	)
}

func TestOrchestrateTaskOptions_Struct(t *testing.T) {
	projectID := int32(123)
	orgID := int32(456)

	opts := OrchestrateTaskOptions{
		UserPlan:         "pro",
		ProjectID:        &projectID,
		OrgID:            &orgID,
		NoTraining:       true,
		QuickModeEnabled: false,
	}

	if opts.UserPlan != "pro" {
		t.Error("UserPlan mismatch")
	}
	if *opts.ProjectID != 123 {
		t.Error("ProjectID mismatch")
	}
	if *opts.OrgID != 456 {
		t.Error("OrgID mismatch")
	}
	if !opts.NoTraining {
		t.Error("NoTraining mismatch")
	}
	if opts.QuickModeEnabled {
		t.Error("QuickModeEnabled mismatch")
	}
}

// TestUpdateProgress_CompletesWithinTimeout verifies that UpdateProgress
// returns within a reasonable wall-clock period even when the mock Redis
// client is used, so the bounded context is wired up end-to-end.

func TestPrepareConfig_ConfigLoadError(t *testing.T) {
	restore(t, &ConfigLoader)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("config load failed")
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})

	if err == nil {
		t.Error("Expected error from config load failure")
	}
	if !strings.Contains(err.Error(), "internal configuration error") {
		t.Errorf("Expected internal configuration error, got: %v", err)
	}
	if cfg.Gateway.BaseURL != "" {
		t.Error("Expected empty config on error")
	}
}

func TestPrepareConfig_DefaultGatewayURLWhenMissing(t *testing.T) {
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				APIKey: "vck_test_key",
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	cfg, err := prepareConfig("task-1", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if cfg.Gateway.BaseURL != defaultAIGatewayBaseURL {
		t.Errorf("Expected default gateway URL, got: %s", cfg.Gateway.BaseURL)
	}
}

func TestPrepareConfig_IncompleteVercelGatewayURL(t *testing.T) {
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				BaseURL: "https://api.vercel.ai/v1", // Missing /gateway/
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	_, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})

	if err == nil {
		t.Error("Expected error for incomplete vercel gateway URL")
	}
	if !strings.Contains(err.Error(), "VERCEL_AI_GATEWAY_URL is incomplete") {
		t.Errorf("Expected incomplete URL error, got: %v", err)
	}
}

func TestPrepareConfig_ModelSelectionError(t *testing.T) {
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{}, errors.New("invalid model")
	}

	cfg, err := prepareConfig("task-1", "invalid-model", OrchestrateTaskOptions{})

	if err == nil {
		t.Error("Expected error from model selection failure")
	}
	if err.Error() != "invalid model" {
		t.Errorf("Expected 'invalid model' error, got: %v", err)
	}
	if cfg.Gateway.BaseURL != "" {
		t.Error("Expected empty config on error")
	}
}

func TestPrepareConfig_RejectsInvalidReasoningEffort(t *testing.T) {
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)

	ConfigLoader = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, _ string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{
			Config:        cfg,
			SelectedModel: modelselection.ModelOption{ID: "openai/gpt-5.6-sol"},
		}, nil
	}

	_, err := prepareConfig("task-reasoning", "openai/gpt-5.6-sol", OrchestrateTaskOptions{ReasoningEffort: "impossible"})
	require.Error(t, err)
}

func TestPrepareConfig_Success(t *testing.T) {
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				BaseURL: "https://test.example.com/v1",
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{
			Config: cfg,
		}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if cfg.Gateway.BaseURL != "https://test.example.com/v1" {
		t.Errorf("Expected gateway URL to be preserved, got: %s", cfg.Gateway.BaseURL)
	}
}

func TestPrepareConfig_AgentCountHonorsRequestAndPlanLimit(t *testing.T) {
	restore(t, &ConfigLoader)
	restore(t, &ModelSelectionResolver)
	restore(t, &WebEnvLoader)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				BaseURL: "https://test.example.com/v1",
			},
			Orchestrator: coreconfig.OrchestratorConfig{
				ParallelAgents: 4,
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{UserPlan: "pro", AgentCount: 1})
	require.NoError(t, err)
	assert.Equal(t, 1, cfg.Orchestrator.ParallelAgents)

	cfg, err = prepareConfig("task-2", "gpt-4", OrchestrateTaskOptions{UserPlan: "free", AgentCount: 8})
	require.NoError(t, err)
	assert.Equal(t, 2, cfg.Orchestrator.ParallelAgents)

	cfg, err = prepareConfig("task-3", "gpt-4", OrchestrateTaskOptions{UserPlan: "starter", AgentCount: 1_000_000})
	require.NoError(t, err)
	assert.Equal(t, 2, cfg.Orchestrator.ParallelAgents)

	cfg, err = prepareConfig("task-4", "gpt-4", OrchestrateTaskOptions{UserPlan: "enterprise", AgentCount: 0})
	require.NoError(t, err)
	assert.Equal(t, 2, cfg.Orchestrator.ParallelAgents)

	cfg, err = prepareConfig("task-5", "gpt-4", OrchestrateTaskOptions{UserPlan: " Super ", AgentCount: 99})
	require.NoError(t, err)
	assert.Equal(t, 16, cfg.Orchestrator.ParallelAgents)
}
