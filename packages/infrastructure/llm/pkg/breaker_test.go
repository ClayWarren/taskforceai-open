package pkg

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLLMAdaptersUseProviderWideCircuitBreakers(t *testing.T) {
	openAI1 := NewOpenAIAdapter(config.Config{})
	openAI2 := NewOpenAIAdapter(config.Config{})
	require.NotNil(t, openAI1.breaker)
	assert.Same(t, openAI1.breaker, openAI2.breaker)

	anthropic1 := NewAnthropicAdapter(config.Config{})
	anthropic2 := NewAnthropicAdapter(config.Config{})
	require.NotNil(t, anthropic1.breaker)
	assert.Same(t, anthropic1.breaker, anthropic2.breaker)

	gemini1 := getGeminiCircuitBreaker()
	gemini2 := getGeminiCircuitBreaker()
	require.NotNil(t, gemini1)
	assert.Same(t, gemini1, gemini2)
}

func TestOpenAICircuitBreakersAreIsolatedByUpstream(t *testing.T) {
	defaultAdapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{
		BaseURL: "https://gateway.example/v1",
	}})
	sameUpstream := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{
		BaseURL: "https://gateway.example/v1/",
	}})
	otherUpstream := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{
		BaseURL: "https://custom.example/v1",
	}})
	require.Same(t, defaultAdapter.breaker, sameUpstream.breaker)
	require.NotSame(t, defaultAdapter.breaker, otherUpstream.breaker)

	adapterWithCustomModel := NewOpenAIAdapter(config.Config{
		Gateway: config.GatewayConfig{BaseURL: "https://gateway.example/v1"},
		Models: config.ModelsConfig{Options: []config.ModelOption{{
			ID:      "custom/model",
			BaseURL: "https://model.example/v1",
		}}},
	})
	require.NotSame(
		t,
		adapterWithCustomModel.breaker,
		adapterWithCustomModel.circuitBreakerForModel("custom/model"),
	)
	require.Same(
		t,
		adapterWithCustomModel.breaker,
		adapterWithCustomModel.circuitBreakerForModel("openai/default"),
	)
}
