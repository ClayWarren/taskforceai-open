package llmadapter

import (
	"context"

	"github.com/TaskForceAI/core/pkg/agent"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	llmpkg "github.com/TaskForceAI/infrastructure/llm/pkg"
)

func Resolve(ctx context.Context, cfg coreconfig.Config, _ string) (agent.ILLMClient, error) {
	return llmpkg.NewRoutingAdapter(ctx, cfg)
}
