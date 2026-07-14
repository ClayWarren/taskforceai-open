package core

import (
	"context"
	"fmt"
)

type SessionRunner struct {
	Processor *Processor
	System    []string
	SessionID string
}

func NewSessionRunner(processor *Processor) *SessionRunner {
	return &SessionRunner{Processor: processor}
}

func (r *SessionRunner) Run(prompt string, stream Stream) (Transcript, error) {
	return r.RunWithContext(context.Background(), prompt, stream)
}

func (r *SessionRunner) RunWithContext(ctx context.Context, prompt string, stream Stream) (Transcript, error) { //nolint:contextcheck // Nil is supported for compatibility with Run.
	if ctx == nil {
		ctx = context.Background()
	}
	if r.Processor == nil {
		return Transcript{}, fmt.Errorf("processor not configured")
	}
	r.Processor.SetContext(ctx)
	user, assistant := r.Processor.BeginWithSystem(prompt, r.System, r.SessionID)
	for {
		if err := ctx.Err(); err != nil {
			return Transcript{}, err
		}
		ev, ok, err := stream.Next()
		if err != nil {
			return Transcript{}, fmt.Errorf("stream next: %w", err)
		}
		if !ok {
			break
		}
		r.Processor.ApplyEvent(&assistant, ev)
		if ev.Type == EventFinishStep {
			break
		}
	}
	return Transcript{Messages: []Message{user, assistant}}, nil
}

// RunLLM adapts an LLMStream into core events.
func (r *SessionRunner) RunLLM(prompt string, llmStream LLMStream) (Transcript, error) {
	adapter := NewLLMStreamAdapter(llmStream)
	return r.Run(prompt, adapter)
}
