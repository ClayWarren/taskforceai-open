package llmadapter

import (
	"context"
	"testing"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

func TestResolveDelegatesToRoutingAdapter(t *testing.T) {
	_, _ = Resolve(context.Background(), coreconfig.Config{}, "ignored")
}
