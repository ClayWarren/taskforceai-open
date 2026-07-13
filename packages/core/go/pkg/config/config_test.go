package config

import (
	"testing"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveSystemPrompt(t *testing.T) {
	c := Config{
		Gateway: GatewayConfig{
			Model: "default-model",
		},
		Models: ModelsConfig{
			Default: "fallback-model",
			Options: []ModelOption{
				{
					ID:           "model1",
					SystemPrompt: "System Prompt 1",
				},
				{
					ID:           "model2",
					SystemPrompt: "System Prompt 2",
				},
			},
		},
		SystemPrompt: "Global System Prompt",
	}

	// Request specific model with system prompt
	assert.Equal(t, "System Prompt 1", c.ResolveSystemPrompt("model1"))
	assert.Equal(t, "System Prompt 2", c.ResolveSystemPrompt("model2"))

	// Request model without specific prompt, should fallback to global
	assert.Equal(t, "Global System Prompt", c.ResolveSystemPrompt("model3"))

	// Request empty model, should use gateway model, which isn't in options, so global fallback
	assert.Equal(t, "Global System Prompt", c.ResolveSystemPrompt(""))

	// Change gateway model to map to model1
	c.Gateway.Model = "model1"
	assert.Equal(t, "System Prompt 1", c.ResolveSystemPrompt(""))

	// Change gateway model to empty, should fallback to Models.Default
	c.Gateway.Model = ""
	c.Models.Default = "model2"
	assert.Equal(t, "System Prompt 2", c.ResolveSystemPrompt(""))

	// Empty options, empty gateway, empty model, empty global
	cEmpty := Config{}
	assert.Empty(t, cEmpty.ResolveSystemPrompt(""))
}

func TestApplyEnginecoreOverrides(t *testing.T) {
	cfg := &Config{}

	// Set an environment variable so `applyEnginecoreOverrides` sees it
	t.Setenv("TASKFORCE_CONFIG", "dummy_path_that_fails_but_code_runs")
	t.Setenv("TASKFORCE_DISABLE_OVERRIDE", "false")

	// Call the generic override function, it will fail to load a dummy yaml but hit coverage
	err := applyEnginecoreOverrides(cfg)
	require.NoError(t, err) // since dummy path doesn't exist, it might ignore the error

	// Test the specific mappers
	tfCfg := &enginecoreconfig.TaskForceAIConfig{
		Gateway: &enginecoreconfig.TaskForceAIGatewayConfig{
			APIKey: new("key"), BaseURL: new("url"), Model: new("m1"), DefaultHeaders: map[string]string{"h": "v"},
		},
		Models: &enginecoreconfig.TaskForceAIModelsConfig{
			Default: new("m2"),
			Options: []enginecoreconfig.TaskForceAIModelOption{
				{ID: "opt1", SystemPrompt: "sys"},
			},
		},
		Agent: &enginecoreconfig.TaskForceAIAgentConfig{
			MaxIterations: new(10), Temperature: new(0.5),
		},
		Orchestrator: &enginecoreconfig.TaskForceAIOrchestratorConfig{
			ParallelAgents: new(5), AggregationStrategy: new("test"),
		},
		Search: &enginecoreconfig.TaskForceAISearchConfig{
			Provider: new("google"),
		},
		WebApp: &enginecoreconfig.TaskForceAIWebAppConfig{},
		CORS: &enginecoreconfig.TaskForceAICORSConfig{
			AllowedOrigins: []string{"test-origin"},
		},
	}

	applyEnginecoreGateway(cfg, tfCfg)
	assert.Equal(t, "key", cfg.Gateway.APIKey)

	applyEnginecoreModels(cfg, tfCfg)
	assert.Equal(t, "m2", cfg.Models.Default)
	assert.Len(t, cfg.Models.Options, 1)

	applyEnginecoreAgent(cfg, tfCfg)
	assert.Equal(t, 10, cfg.Agent.MaxIterations)
	assert.NotNil(t, cfg.Agent.Temperature)

	applyEnginecoreOrchestrator(cfg, tfCfg)
	assert.Equal(t, 5, cfg.Orchestrator.ParallelAgents)

	applyEnginecoreSearch(cfg, tfCfg)
	assert.Equal(t, "google", cfg.Search.Provider)

	applyEnginecoreWebApp(cfg, tfCfg)

	applyEnginecoreCORS(cfg, tfCfg)
	assert.Equal(t, []string{"test-origin"}, cfg.CORS.AllowedOrigins)
}
