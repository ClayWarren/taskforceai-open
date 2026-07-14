package run

import (
	"errors"
	"testing"

	configpkg "github.com/TaskForceAI/config/pkg"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	modelselection "github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWebEnvLoader_Applied(t *testing.T) {
	originalLoader := ConfigLoader
	originalResolver := ModelSelectionResolver
	originalWebEnvLoader := WebEnvLoader
	defer func() {
		ConfigLoader = originalLoader
		ModelSelectionResolver = originalResolver
		WebEnvLoader = originalWebEnvLoader
	}()

	ConfigLoader = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{Gateway: coreconfig.GatewayConfig{
			BaseURL: "https://original.example.com/v1", APIKey: "original-key",
		}}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, _ string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{
			AIGatewayAPIKey: "web-env-key", VercelAIGatewayURL: "https://web-env.example.com/gateway/v1",
		}, nil
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})
	require.NoError(t, err)
	assert.Equal(t, "web-env-key", cfg.Gateway.APIKey)
	assert.Equal(t, "https://web-env.example.com/gateway/v1", cfg.Gateway.BaseURL)
}

func TestPrepareConfig_WebEnvLoaderErrorKeepsBaseGateway(t *testing.T) {
	originalLoader := ConfigLoader
	originalResolver := ModelSelectionResolver
	originalWebEnvLoader := WebEnvLoader
	defer func() {
		ConfigLoader = originalLoader
		ModelSelectionResolver = originalResolver
		WebEnvLoader = originalWebEnvLoader
	}()

	ConfigLoader = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{Gateway: coreconfig.GatewayConfig{
			BaseURL: "https://original.example.com/v1", APIKey: "original-key",
		}}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, _ string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return nil, errors.New("invalid web env")
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})
	require.NoError(t, err)
	assert.Equal(t, "original-key", cfg.Gateway.APIKey)
	assert.Equal(t, "https://original.example.com/v1", cfg.Gateway.BaseURL)
}
