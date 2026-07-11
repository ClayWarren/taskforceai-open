package core

import (
	"sync"
)

type SystemPromptBuilder struct {
	Instructions []string
}

type SystemPromptSource interface {
	SystemPrompt(model ProviderModel) []string
}

type SystemEnvironmentSource interface {
	SystemPromptEnvironment(model ProviderModel, cwd string, limit int) []string
}

type emptySystemPromptSource struct{}

func (emptySystemPromptSource) SystemPrompt(ProviderModel) []string {
	return nil
}

type emptySystemEnvironmentSource struct{}

func (emptySystemEnvironmentSource) SystemPromptEnvironment(ProviderModel, string, int) []string {
	return nil
}

var (
	systemPromptSourceMu sync.RWMutex
	systemPromptSource   SystemPromptSource = emptySystemPromptSource{}

	systemEnvironmentSourceMu sync.RWMutex
	systemEnvironmentSource   SystemEnvironmentSource = emptySystemEnvironmentSource{}
)

func SetSystemPromptSource(source SystemPromptSource) func() {
	if source == nil {
		source = emptySystemPromptSource{}
	}

	systemPromptSourceMu.Lock()
	previous := systemPromptSource
	systemPromptSource = source
	systemPromptSourceMu.Unlock()

	return func() {
		systemPromptSourceMu.Lock()
		systemPromptSource = previous
		systemPromptSourceMu.Unlock()
	}
}

func SetSystemEnvironmentSource(source SystemEnvironmentSource) func() {
	if source == nil {
		source = emptySystemEnvironmentSource{}
	}

	systemEnvironmentSourceMu.Lock()
	previous := systemEnvironmentSource
	systemEnvironmentSource = source
	systemEnvironmentSourceMu.Unlock()

	return func() {
		systemEnvironmentSourceMu.Lock()
		systemEnvironmentSource = previous
		systemEnvironmentSourceMu.Unlock()
	}
}

func (b SystemPromptBuilder) Build() []string {
	return append([]string{}, b.Instructions...)
}

func SystemPromptProvider(model ProviderModel) []string {
	systemPromptSourceMu.RLock()
	source := systemPromptSource
	systemPromptSourceMu.RUnlock()

	return SystemPromptFromSource(source, model)
}

func SystemPromptFromSource(source SystemPromptSource, model ProviderModel) []string {
	if source == nil {
		return nil
	}
	prompts := source.SystemPrompt(model)
	if len(prompts) == 0 {
		return nil
	}
	return append([]string{}, prompts...)
}

func SystemPromptEnvironment(model ProviderModel, cwd string, limit int) []string {
	systemEnvironmentSourceMu.RLock()
	source := systemEnvironmentSource
	systemEnvironmentSourceMu.RUnlock()

	return SystemPromptEnvironmentFromSource(source, model, cwd, limit)
}

func SystemPromptEnvironmentFromSource(source SystemEnvironmentSource, model ProviderModel, cwd string, limit int) []string {
	if source == nil {
		return nil
	}
	prompts := source.SystemPromptEnvironment(model, cwd, limit)
	if len(prompts) == 0 {
		return nil
	}
	return append([]string{}, prompts...)
}
