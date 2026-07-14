package run

import (
	"context"

	"github.com/TaskForceAI/core/pkg/agent"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	configadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/config"
	enginecoreadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/enginecore"
	llmadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/llm"
)

func loadCoreConfig(configPath string) (coreconfig.Config, error) {
	promptProvider := PromptProvider()
	configadapter.InstallConfigLoaderSource()
	enginecoreadapter.InstallSources()
	coreconfig.SetPromptOverrideProvider(promptProvider)
	return coreconfig.LoadConfig(configPath)
}

func resolveAdapter(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
	return llmadapter.Resolve(ctx, cfg, modelID)
}
