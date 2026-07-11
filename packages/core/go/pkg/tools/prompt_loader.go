package tools

import (
	"strings"
	"sync"
)

type ToolPromptProvider interface {
	ToolPrompt(name string) string
}

type emptyToolPromptProvider struct{}

func (emptyToolPromptProvider) ToolPrompt(string) string {
	return ""
}

var (
	toolPromptProviderMu sync.RWMutex
	toolPromptProvider   ToolPromptProvider = emptyToolPromptProvider{}
)

func SetToolPromptProvider(provider ToolPromptProvider) func() {
	if provider == nil {
		provider = emptyToolPromptProvider{}
	}

	toolPromptProviderMu.Lock()
	previous := toolPromptProvider
	toolPromptProvider = provider
	toolPromptProviderMu.Unlock()

	return func() {
		toolPromptProviderMu.Lock()
		toolPromptProvider = previous
		toolPromptProviderMu.Unlock()
	}
}

func LoadToolPrompt(name string) string {
	toolPromptProviderMu.RLock()
	provider := toolPromptProvider
	toolPromptProviderMu.RUnlock()

	return LoadToolPromptFromProvider(provider, name)
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
