package executionpolicy

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestApplyComputerUseSessionMode(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		assert.Equal(t, "project instructions", ApplyComputerUseSessionMode("project instructions", false, true))
	})

	t.Run("logged out without project instructions", func(t *testing.T) {
		instructions := ApplyComputerUseSessionMode("  ", true, false)

		assert.Contains(t, instructions, "Mode: LOGGED OUT")
		assert.Contains(t, instructions, "logged-out browsing context")
	})

	t.Run("logged in with project instructions", func(t *testing.T) {
		instructions := ApplyComputerUseSessionMode("project instructions", true, true)

		assert.True(t, strings.HasPrefix(instructions, "project instructions\n\n"))
		assert.Contains(t, instructions, "Mode: LOGGED IN")
		assert.Contains(t, instructions, "authenticated website sessions")
	})
}

func TestEnforceQuickModeIdentity(t *testing.T) {
	const identityReply = "I am TaskForceAI."

	tests := []struct {
		name    string
		prompt  string
		modelID string
		result  string
		want    string
	}{
		{name: "other model", prompt: "who are you", modelID: "openai/gpt-5", result: "normal", want: "normal"},
		{name: "ordinary quick mode response", prompt: "summarize this", modelID: "zai/glm-5.2", result: "normal", want: "normal"},
		{name: "identity prompt", prompt: "  Who CREATED you?  ", modelID: "zai/glm-5.2", result: "normal", want: identityReply},
		{name: "provider identity leak", prompt: "summarize this", modelID: "zai/glm-5.2", result: "I am GLM, ready to help.", want: identityReply},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, EnforceQuickModeIdentity(test.prompt, test.modelID, test.result, identityReply))
		})
	}
}

func TestRunProfileKey(t *testing.T) {
	orgID := int32(42)

	assert.Equal(t, "user:7", RunProfileKey(7, nil))
	assert.Equal(t, "org:42:user:7", RunProfileKey(7, &orgID))
}

func TestIsMediaGenerationModelID(t *testing.T) {
	assert.True(t, IsMediaGenerationModelID("google/gemini-2.5-flash-image"))
	assert.False(t, IsMediaGenerationModelID("openai/gpt-5"))
}
