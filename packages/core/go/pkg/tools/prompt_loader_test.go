package tools

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

type testToolPromptProvider map[string]string

func (p testToolPromptProvider) ToolPrompt(name string) string {
	return p[name]
}

func TestLoadToolPromptBranches(t *testing.T) {
	restore := SetToolPromptProvider(testToolPromptProvider{
		"websearch":    " search prompt ",
		"computer_use": " computer prompt ",
	})
	t.Cleanup(restore)

	assert.Empty(t, LoadToolPrompt(""))
	assert.Equal(t, "websearch", toolPromptAlias("search_web"))
	assert.Equal(t, "bash", toolPromptAlias("execute_code"))
	assert.Equal(t, "task", toolPromptAlias("mark_task_complete"))
	assert.Empty(t, toolPromptAlias("read"))
	assert.Equal(t, "search prompt", LoadToolPrompt("search_web"))
	assert.Equal(t, "computer prompt", LoadToolPrompt("computer_use"))
	assert.Empty(t, LoadToolPrompt("missing"))
	assert.Empty(t, LoadToolPromptFromProvider(nil, "search_web"))

	restore()
	assert.Empty(t, LoadToolPrompt("search_web"))
}

func TestSetToolPromptProviderNilInstallsEmptyProvider(t *testing.T) {
	restore := SetToolPromptProvider(nil)
	t.Cleanup(restore)

	assert.Empty(t, LoadToolPrompt("search_web"))
}
