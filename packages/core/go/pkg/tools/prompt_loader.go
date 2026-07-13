package tools

import (
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
)

type ToolPromptProvider interface {
	ToolPrompt(name string) string
}

type emptyToolPromptProvider struct{}

func (emptyToolPromptProvider) ToolPrompt(string) string {
	return ""
}

var toolPromptProviders = runtimevalue.New[ToolPromptProvider](emptyToolPromptProvider{})

func SetToolPromptProvider(provider ToolPromptProvider) func() {
	return toolPromptProviders.Set(provider)
}

func LoadToolPrompt(name string) string {
	return LoadToolPromptFromProvider(toolPromptProviders.Current(), name)
}

func LoadToolPromptFromProvider(provider ToolPromptProvider, name string) string {
	if name == "" || provider == nil {
		return ""
	}
	if alias := toolPromptAlias(name); alias != "" {
		name = alias
	}
	return strings.TrimSpace(provider.ToolPrompt(name))
}

func toolPromptAlias(name string) string {
	switch name {
	case "search_web":
		return "websearch"
	case "execute_code":
		return "bash"
	case "mark_task_complete":
		return "task"
	default:
		return ""
	}
}
