package core

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

type testSystemPromptSource []string

func (s testSystemPromptSource) SystemPrompt(ProviderModel) []string {
	return []string(s)
}

type testSystemEnvironmentSource []string

func (s testSystemEnvironmentSource) SystemPromptEnvironment(ProviderModel, string, int) []string {
	return []string(s)
}

func resetSystemPromptSource(t *testing.T) {
	t.Helper()
	t.Cleanup(SetSystemPromptSource(nil))
	t.Cleanup(SetSystemEnvironmentSource(nil))
}

func TestSystemPromptProviderUsesInjectedSource(t *testing.T) {
	resetSystemPromptSource(t)
	SetSystemPromptSource(testSystemPromptSource{" be useful "})

	provider := SystemPromptProvider(ProviderModel{ProviderID: "p", ModelID: "m"})
	assert.Equal(t, []string{" be useful "}, provider)

	provider[0] = "mutated"
	assert.Equal(t, []string{" be useful "}, SystemPromptProvider(ProviderModel{ProviderID: "p", ModelID: "m"}))
}

func TestSystemPromptBuilder(t *testing.T) {
	b := SystemPromptBuilder{Instructions: []string{"i1", "i2"}}
	res := b.Build()
	assert.Equal(t, []string{"i1", "i2"}, res)
}

func TestSystemPromptEnvironment(t *testing.T) {
	resetSystemPromptSource(t)

	tmpDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("data"), 0600)
	SetSystemEnvironmentSource(testSystemEnvironmentSource{"env prompt"})

	model := ProviderModel{ProviderID: "p", ModelID: "m"}
	res := SystemPromptEnvironment(model, tmpDir, 10)

	assert.Len(t, res, 1)
	assert.Equal(t, "env prompt", res[0])

	res[0] = "mutated"
	assert.Equal(t, []string{"env prompt"}, SystemPromptEnvironment(model, tmpDir, 10))
}

func TestSystemPromptGapCoverage(t *testing.T) {
	t.Run("provider returns nil without source", func(t *testing.T) {
		resetSystemPromptSource(t)

		assert.Nil(t, SystemPromptProvider(ProviderModel{ProviderID: "p", ModelID: "m"}))
	})

	t.Run("source helper tolerates nil source", func(t *testing.T) {
		assert.Nil(t, SystemPromptFromSource(nil, ProviderModel{ProviderID: "p", ModelID: "m"}))
	})

	t.Run("environment helper tolerates nil source", func(t *testing.T) {
		model := ProviderModel{ProviderID: "openai", ModelID: "gpt-test"}
		assert.Nil(t, SystemPromptEnvironmentFromSource(nil, model, "", 5))
	})

	t.Run("environment prompt uses injected source", func(t *testing.T) {
		resetSystemPromptSource(t)
		SetSystemEnvironmentSource(testSystemEnvironmentSource{"env"})

		assert.Equal(t, []string{"env"}, SystemPromptEnvironment(ProviderModel{ProviderID: "p", ModelID: "m"}, "", 5))
	})
}
