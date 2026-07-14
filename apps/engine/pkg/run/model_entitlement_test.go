package run

import (
	"testing"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/require"
)

func TestValidateModelEntitlements(t *testing.T) {
	require.ErrorContains(
		t,
		validateModelEntitlements("free", "google/gemini-3.1-pro-preview", nil),
		"requires a Pro or Super subscription",
	)
	require.ErrorContains(
		t,
		validateModelEntitlements("free", "zai/glm-5.2", map[string]string{
			"researcher": "anthropic/claude-sonnet-5",
		}),
		"requires a Pro or Super subscription",
	)
	require.NoError(t, validateModelEntitlements("pro", "openai/gpt-5.6-sol", map[string]string{
		"researcher": "anthropic/claude-fable-5",
	}))
	require.NoError(t, validateModelEntitlements("free", "google/gemini-3.1-flash-lite", nil))
}

func TestPrepareConfig_EvalCannotBypassModelEntitlements(t *testing.T) {
	restore(t, &ConfigLoader)
	ConfigLoader = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{}, nil
	}

	_, err := prepareConfig("task-eval", "openai/gpt-5.6-sol", OrchestrateTaskOptions{
		UserPlan: "free",
		IsEval:   true,
	})

	require.ErrorContains(t, err, "requires a Pro or Super subscription")
}
