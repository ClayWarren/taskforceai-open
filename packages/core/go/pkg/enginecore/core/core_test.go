package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSliceStream(t *testing.T) {
	events := []Event{
		{Type: "text"},
		{Type: "tool_call"},
	}
	s := NewSliceStream(events)

	ev, ok, err := s.Next()
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, EventType("text"), ev.Type)

	ev, ok, err = s.Next()
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, EventType("tool_call"), ev.Type)

	ev, ok, err = s.Next()
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Empty(t, ev.Type)
}

func TestSystemPrompt(t *testing.T) {
	tmpDir := t.TempDir()

	resetSystemPromptSource(t)
	SetSystemPromptSource(testSystemPromptSource{"test prompt"})
	SetSystemEnvironmentSource(testSystemEnvironmentSource{"environment prompt"})

	assert.Equal(t, []string{"test prompt"}, SystemPromptProvider(ProviderModel{}))

	// Test repeated calls are source-backed and stable.
	assert.Equal(t, []string{"test prompt"}, SystemPromptProvider(ProviderModel{}))

	// Environment
	envPrompt := SystemPromptEnvironment(ProviderModel{
		ProviderID: "test-prov",
		ModelID:    "test-model",
	}, tmpDir, 1)

	assert.Len(t, envPrompt, 1)
	assert.Equal(t, "environment prompt", envPrompt[0])
}

func TestRetryError(t *testing.T) {
	err := &APIError{
		Message:     "base err",
		IsRetryable: true,
	}
	assert.Contains(t, err.Error(), "base err")
	assert.Equal(t, "base err", Retryable(err))
}

func TestLLMChannelSetWaitTimeout(t *testing.T) {
	ch := NewChannelLLMStream()
	ch.SetWaitTimeout(10) // Should just execute without panic
}

func TestProcessorSetModel(t *testing.T) {
	p := NewProcessorWithIDs(".", nil)
	p.SetModel(ProviderModel{ModelID: "test"})
	assert.Equal(t, "test", p.model.ModelID)

	p.SetCostCalculator(nil)
	assert.Nil(t, p.cost)
}
