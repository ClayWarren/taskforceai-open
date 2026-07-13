package core

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type recordingStatusBus struct {
	events []statusEvent
}

type statusEvent struct {
	sessionID string
	status    StatusInfo
}

func (b *recordingStatusBus) Publish(sessionID string, status StatusInfo) {
	b.events = append(b.events, statusEvent{sessionID: sessionID, status: status})
}

func (b *recordingStatusBus) typesFor(sessionID string) []StatusType {
	types := make([]StatusType, 0, len(b.events))
	for _, ev := range b.events {
		if ev.sessionID == sessionID {
			types = append(types, ev.status.Type)
		}
	}
	return types
}

type alwaysErrorStream struct {
	err error
}

func (s *alwaysErrorStream) Next() (Event, bool, error) {
	return Event{}, false, s.err
}

type retryThenSuccessStream struct {
	calls int
}

func (s *retryThenSuccessStream) Next() (Event, bool, error) {
	s.calls++
	switch s.calls {
	case 1:
		return Event{}, false, &APIError{
			Message:     "retry me",
			IsRetryable: true,
			ResponseHeaders: map[string]string{
				"retry-after-ms": "0",
			},
		}
	case 2:
		return Event{Type: EventText, Text: "after retry"}, true, nil
	case 3:
		return Event{Type: EventFinishStep}, true, nil
	default:
		return Event{}, false, nil
	}
}

type cancelDuringRetryStream struct {
	cancel context.CancelFunc
	calls  int
}

func (s *cancelDuringRetryStream) Next() (Event, bool, error) {
	s.calls++
	if s.calls == 1 {
		if s.cancel != nil {
			s.cancel()
		}
		return Event{}, false, &APIError{
			Message:     "retryable failure",
			IsRetryable: true,
			ResponseHeaders: map[string]string{
				"retry-after-ms": "25",
			},
		}
	}
	return Event{}, false, nil
}

type failingProviderResolver struct{}

func (failingProviderResolver) GetModel(providerID, modelID string) (ProviderModel, error) {
	return ProviderModel{}, errors.New("model unavailable")
}

type sequenceIDGenerator struct {
	count int
}

func (g *sequenceIDGenerator) Next(prefix string) string {
	g.count++
	return prefix + "-id"
}

func TestOrchestratorCoverageGapPaths(t *testing.T) {
	t.Run("run with context prunes tool outputs and compacts stored history", func(t *testing.T) {
		sessionID := "compact-session"
		huge := strings.Repeat("x", 80000)
		store := NewStore()
		store.Append(sessionID,
			Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-old"}}},
			Message{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{
				Type:  PartTool,
				Tool:  "grep",
				State: &ToolState{Status: "completed", Output: huge},
			}}},
			Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-mid"}}},
			Message{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{
				Type:  PartTool,
				Tool:  "grep",
				State: &ToolState{Status: "completed", Output: huge},
			}}},
			Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-recent-1"}}},
			Message{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "a-recent-1"}}},
			Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-recent-2"}}},
			Message{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "a-recent-2"}}},
		)

		bus := NewBus()
		compactor := &Compactor{Options: CompactionOptions{Auto: true, Prune: true}, Bus: bus}
		summary := SummaryGenerator{MaxLines: 5}
		proc := NewProcessorWithIDs(".", nil)
		runner := NewSessionRunner(proc)
		orch := NewOrchestrator(runner, nil, compactor)
		orch.Store = store
		orch.Summary = &summary

		_, err := orch.RunWithContext(context.Background(), RunOptions{
			SessionID: sessionID,
			Prompt:    "follow up",
			Stream: NewSliceStream([]Event{
				{Type: EventText, Text: "done"},
				{Type: EventFinishStep},
			}),
		})
		require.NoError(t, err)

		msgs := store.Messages(sessionID)
		pruned := false
		for _, msg := range msgs {
			for _, part := range msg.Parts {
				if part.Type == PartTool && part.State != nil {
					if meta, ok := part.State.Metadata["compacted"].(bool); ok && meta {
						pruned = true
					}
				}
			}
		}
		assert.True(t, pruned || len(msgs) < 8, "expected prune or compact to shrink stored history")
	})

	t.Run("run with retry defaults attempts and stops on non retryable errors", func(t *testing.T) {
		proc := NewProcessorWithIDs(".", nil)
		runner := NewSessionRunner(proc)
		orch := NewOrchestrator(runner, nil, nil)

		_, err := orch.RunWithRetryContext(context.Background(), RunOptions{
			SessionID: "retry-default",
			Prompt:    "fail",
			Stream: &alwaysErrorStream{
				err: errors.New("hard failure"),
			},
		}, RetryOptions{MaxAttempts: 0})
		require.Error(t, err)
		assert.ErrorContains(t, err, "hard failure")
	})
}

func TestOrchestratorRunWithContext_MetadataStoreAndProviderError(t *testing.T) {
	t.Run("stores messages with generated metadata", func(t *testing.T) {
		proc := NewProcessorWithIDs(".", nil)
		runner := NewSessionRunner(proc)
		store := NewStore()
		orch := NewOrchestrator(runner, nil, nil)
		orch.Store = store
		orch.IDs = &sequenceIDGenerator{}

		transcript, err := orch.RunWithContext(context.Background(), RunOptions{
			SessionID: "session-meta",
			Prompt:    "hello",
			Stream: NewSliceStream([]Event{
				{Type: EventText, Text: "hello"},
				{Type: EventFinishStep},
			}),
			Cwd:  t.TempDir(),
			Root: t.TempDir(),
		})
		require.NoError(t, err)
		require.NotEmpty(t, transcript.Messages)
		stored := store.Messages("session-meta")
		require.NotEmpty(t, stored)
		assert.Equal(t, "session-meta", stored[0].Info.SessionID)
		assert.NotZero(t, stored[0].Info.TimeCreated)
		assert.NotEmpty(t, stored[0].Info.ID)
	})

	t.Run("provider resolution error is returned", func(t *testing.T) {
		proc := NewProcessorWithIDs(".", nil)
		runner := NewSessionRunner(proc)
		orch := NewOrchestrator(runner, nil, nil)
		orch.Provider = failingProviderResolver{}

		_, err := orch.RunWithContext(context.Background(), RunOptions{
			SessionID: "provider-error",
			Prompt:    "hello",
			Stream:    NewSliceStream([]Event{}),
		})
		require.Error(t, err)
		assert.ErrorContains(t, err, "resolve model")
	})
}

func TestOrchestratorRunWithContext_StatusTransitionsOnError(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	bus := &recordingStatusBus{}
	status := NewSessionStatus(bus)
	orch := NewOrchestrator(runner, status, nil)

	sessionID := "run-error"
	opts := RunOptions{
		SessionID: sessionID,
		Prompt:    "fails",
		Stream: &alwaysErrorStream{
			err: errors.New("stream exploded"),
		},
	}

	_, err := orch.RunWithContext(context.Background(), opts)
	require.Error(t, err)
	require.ErrorContains(t, err, "run session: stream next: stream exploded")
	assert.Equal(t, StatusIdle, status.Get(sessionID).Type)
	assert.Equal(t, []StatusType{StatusBusy, StatusIdle}, bus.typesFor(sessionID))
}

func TestOrchestratorRunWithContext_StatusTransitionsOnSuccess(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	bus := &recordingStatusBus{}
	status := NewSessionStatus(bus)
	orch := NewOrchestrator(runner, status, nil)

	sessionID := "run-success"
	opts := RunOptions{
		SessionID: sessionID,
		Prompt:    "say hello",
		Stream: NewSliceStream([]Event{
			{Type: EventText, Text: "hello"},
			{Type: EventFinishStep},
		}),
		System: []string{"sys"},
	}

	transcript, err := orch.RunWithContext(context.Background(), opts)
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
	assert.Equal(t, StatusIdle, status.Get(sessionID).Type)
	assert.Equal(t, []StatusType{StatusBusy, StatusIdle}, bus.typesFor(sessionID))
}

func TestOrchestratorRunWithRetryContext_CancelledDuringBackoff(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	bus := &recordingStatusBus{}
	status := NewSessionStatus(bus)
	orch := NewOrchestrator(runner, status, nil)

	ctx, cancel := context.WithCancel(context.Background())
	sessionID := "retry-cancel"
	stream := &cancelDuringRetryStream{cancel: cancel}
	opts := RunOptions{
		SessionID: sessionID,
		Prompt:    "cancel path",
		Stream:    stream,
	}

	_, err := orch.RunWithRetryContext(ctx, opts, RetryOptions{MaxAttempts: 3})
	require.Error(t, err)
	require.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 1, stream.calls)
	assert.Equal(t, StatusRetry, status.Get(sessionID).Type)
	assert.Equal(t, []StatusType{StatusBusy, StatusIdle, StatusRetry}, bus.typesFor(sessionID))
}

func TestOrchestratorRunWithRetryContext_RetryThenSuccess(t *testing.T) {
	proc := NewProcessorWithIDs(".", nil)
	runner := NewSessionRunner(proc)
	bus := &recordingStatusBus{}
	status := NewSessionStatus(bus)
	orch := NewOrchestrator(runner, status, nil)

	sessionID := "retry-success"
	stream := &retryThenSuccessStream{}
	opts := RunOptions{
		SessionID: sessionID,
		Prompt:    "retry path",
		Stream:    stream,
	}

	transcript, err := orch.RunWithRetryContext(context.Background(), opts, RetryOptions{MaxAttempts: 2})
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
	assert.Equal(t, 3, stream.calls)
	assert.Equal(t, StatusIdle, status.Get(sessionID).Type)
	assert.Equal(t, []StatusType{StatusBusy, StatusIdle, StatusRetry, StatusBusy, StatusIdle}, bus.typesFor(sessionID))
}
