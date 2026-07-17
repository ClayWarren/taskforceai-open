package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionRun(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	runner.System = []string{"sys"}
	runner.SessionID = "sess1"

	events := []Event{
		{Type: "text", Text: "hello"},
		{Type: "finish_step"},
	}
	stream := NewSliceStream(events)

	transcript, err := runner.Run("prompt1", stream)
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
	assert.Equal(t, Role("user"), transcript.Messages[0].Info.Role)
	assert.Equal(t, Role("assistant"), transcript.Messages[1].Info.Role)
}

func TestSessionRunLLM(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)

	ch := NewChannelLLMStream()
	go func() {
		ch.Push(LLMEvent{Type: "text", Text: "hello llm"})
		ch.Push(LLMEvent{Type: "done"})
		ch.Close()
	}()

	transcript, err := runner.RunLLM("prompt2", ch)
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
}

func TestOrchestratorRunWithRetry(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	orch := NewOrchestrator(runner, nil, nil)

	events := []Event{
		{Type: "text", Text: "hello"},
		{Type: "finish_step"},
	}

	opts := RunOptions{
		SessionID: "s1",
		Prompt:    "hello",
		Stream:    NewSliceStream(events),
		System:    []string{"sys"},
		Cwd:       ".",
	}

	// Should succeed on first try
	transcript, err := orch.RunWithRetry(opts, RetryOptions{MaxAttempts: 3})
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
}

func TestSessionPromptRun(t *testing.T) {
	b := PromptBuilder{System: []string{"base"}}
	p, s := b.Build("my prompt")
	assert.Equal(t, "my prompt", p)
	assert.Equal(t, []string{"base"}, s)

	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	orch := NewOrchestrator(runner, nil, nil)
	sp := &SessionPrompt{Orchestrator: orch}

	opts := RunOptions{
		SessionID: "s1",
		Prompt:    "hello",
		Stream:    NewSliceStream([]Event{{Type: "finish_step"}}),
	}

	transcript, err := sp.Run(opts)
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
}
