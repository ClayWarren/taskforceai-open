package core

import "github.com/TaskForceAI/core/internal/runtimevalue"

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
	systemPromptSources      = runtimevalue.New[SystemPromptSource](emptySystemPromptSource{})
	systemEnvironmentSources = runtimevalue.New[SystemEnvironmentSource](emptySystemEnvironmentSource{})
)

func SetSystemPromptSource(source SystemPromptSource) func() {
	return systemPromptSources.Set(source)
}

func SetSystemEnvironmentSource(source SystemEnvironmentSource) func() {
	return systemEnvironmentSources.Set(source)
}

func (b SystemPromptBuilder) Build() []string {
	return append([]string{}, b.Instructions...)
}

func SystemPromptProvider(model ProviderModel) []string {
	return SystemPromptFromSource(systemPromptSources.Current(), model)
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
	return SystemPromptEnvironmentFromSource(systemEnvironmentSources.Current(), model, cwd, limit)
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
