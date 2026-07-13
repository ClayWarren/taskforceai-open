package core

import (
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// PromptBuilder assembles system + user prompt.
type PromptBuilder struct {
	System []string
}

func (b PromptBuilder) Build(prompt string) (string, []string) {
	return prompt, append([]string{}, b.System...)
}

// SessionPrompt wraps building prompts and running the session.
type SessionPrompt struct {
	Orchestrator *Orchestrator
}

func (s *SessionPrompt) Run(opts RunOptions) (Transcript, error) {
	if s.Orchestrator == nil {
		return Transcript{}, nil
	}
	model := ProviderModel{ProviderID: protocol.DefaultProviderID, ModelID: protocol.DefaultModelID}
	if s.Orchestrator.Provider != nil {
		resolved, err := s.Orchestrator.Provider.GetModel(model.ProviderID, model.ModelID)
		if err == nil {
			model = resolved
		}
	}
	loader := s.Orchestrator.Instructions
	system := []string{}
	if opts.AgentPrompt != "" {
		system = append(system, opts.AgentPrompt)
	} else {
		system = append(system, SystemPromptProvider(model)...)
	}
	system = append(system, SystemPromptEnvironment(model, opts.Cwd, 200)...)
	system = append(system, loader.System()...)
	system = append(system, opts.System...)
	if opts.UserSystem != "" {
		system = append(system, opts.UserSystem)
	}
	joined := strings.TrimSpace(strings.Join(filterEmpty(system), "\n"))
	if joined != "" {
		opts.System = []string{joined}
	}
	return s.Orchestrator.Run(opts)
}

func filterEmpty(items []string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		out = append(out, item)
	}
	return out
}
