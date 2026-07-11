package orchestrator

import "strings"

type PromptProvider interface {
	RolePrompt(name string) string
	SoulContent() string
	ToolPrompt(name string) string
}

type emptyPromptProvider struct{}

func (emptyPromptProvider) RolePrompt(string) string {
	return ""
}

func (emptyPromptProvider) SoulContent() string {
	return ""
}

func (emptyPromptProvider) ToolPrompt(string) string {
	return ""
}

func normalizePromptProvider(provider PromptProvider) PromptProvider {
	if provider == nil {
		return emptyPromptProvider{}
	}
	return provider
}

func loadRolePrompt(name string) string {
	return loadRolePromptFromProvider(nil, name)
}

func loadRolePromptFromProvider(provider PromptProvider, name string) string {
	if name == "" {
		return ""
	}
	return strings.TrimSpace(normalizePromptProvider(provider).RolePrompt(name))
}

func loadSoulContent() string {
	return loadSoulContentFromProvider(nil)
}

func loadSoulContentFromProvider(provider PromptProvider) string {
	return strings.TrimSpace(normalizePromptProvider(provider).SoulContent())
}
