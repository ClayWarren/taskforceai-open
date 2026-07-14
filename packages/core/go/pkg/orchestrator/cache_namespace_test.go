package orchestrator

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewOrchestrator_DefaultCacheNamespaceWhenMissing(t *testing.T) {
	orch := New(config.Config{}, OrchestratorDeps{}, OrchestratorOptions{})
	assert.Equal(t, defaultCacheNamespace, orch.namespace)
}

func TestNewOrchestrator_NormalizesCacheNamespace(t *testing.T) {
	orch := New(config.Config{}, OrchestratorDeps{}, OrchestratorOptions{
		CacheNamespace: "  USER:42  ",
	})

	assert.Equal(t, "user:42", orch.namespace)
}

func TestConsensusAggregation_UsesProvidedNamespaceForExistingCacheKey(t *testing.T) {
	ctx := context.Background()
	mockCache := &MockCache{Data: make(map[string]string)}
	llmCache := cache.NewLLMCache(mockCache)

	err := llmCache.SetCachedSynthesis(ctx, "user:42", []string{"first", "second"}, "cached synthesis")
	require.NoError(t, err)

	orch := New(config.Config{}, OrchestratorDeps{Cache: mockCache}, OrchestratorOptions{
		CacheNamespace: "user:42",
	})
	strategy := &ConsensusAggregationStrategy{orch: orch}

	result, aggErr := strategy.Aggregate(ctx, []string{"second", "first"}, "")
	require.NoError(t, aggErr)
	assert.Equal(t, "cached synthesis", result)
}

func TestConsensusAggregation_UsesDefaultNamespaceWhenMissing(t *testing.T) {
	ctx := context.Background()
	mockCache := &MockCache{Data: make(map[string]string)}
	llmCache := cache.NewLLMCache(mockCache)

	err := llmCache.SetCachedSynthesis(ctx, defaultCacheNamespace, []string{"first", "second"}, "default synthesis")
	require.NoError(t, err)

	orch := New(config.Config{}, OrchestratorDeps{Cache: mockCache}, OrchestratorOptions{})
	strategy := &ConsensusAggregationStrategy{orch: orch}

	result, aggErr := strategy.Aggregate(ctx, []string{"second", "first"}, "")
	require.NoError(t, aggErr)
	assert.Equal(t, "default synthesis", result)
}
