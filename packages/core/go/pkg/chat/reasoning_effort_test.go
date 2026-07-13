package chat

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReasoningEffortConfigForModel(t *testing.T) {
	t.Parallel()

	sol, ok := ReasoningEffortConfigForModel(" OPENAI/GPT-5.6-SOL ")
	require.True(t, ok)
	assert.Equal(t, ReasoningEffortMedium, sol.Default)
	assert.Equal(t, []string{"low", "medium", "high", "xhigh", "max"}, sol.Levels)

	sol.Levels[0] = "changed"
	again, ok := ReasoningEffortConfigForModel("openai/gpt-5.6-sol")
	require.True(t, ok)
	assert.Equal(t, ReasoningEffortLow, again.Levels[0])

	_, ok = ReasoningEffortConfigForModel("zai/glm-5.2")
	assert.False(t, ok)
}

func TestValidateReasoningEffort(t *testing.T) {
	t.Parallel()

	assert.NoError(t, ValidateReasoningEffort("openai/gpt-5.6-sol", " max "))
	assert.NoError(t, ValidateReasoningEffort("zai/glm-5.2", ""))
	require.ErrorContains(t, ValidateReasoningEffort("openai/gpt-5.6-terra", "max"), "not supported")
	assert.ErrorContains(t, ValidateReasoningEffort("zai/glm-5.2", "high"), "does not support")
}

func TestEffectiveReasoningEffort(t *testing.T) {
	t.Parallel()

	assert.Empty(t, EffectiveReasoningEffort("openai/gpt-5.6-sol", ""))
	assert.Empty(t, EffectiveReasoningEffort("zai/glm-5.2", "high"))
	assert.Equal(t, "high", EffectiveReasoningEffort("xai/grok-4.5", "max"))
	assert.Equal(t, "medium", EffectiveReasoningEffort("openai/gpt-5.6-sol", "unknown"))
	assert.Equal(t, "minimal", EffectiveReasoningEffort("google/gemini-3.5-flash", "minimal"))
}
