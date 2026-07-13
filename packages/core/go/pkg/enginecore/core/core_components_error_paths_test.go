package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	ectools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type edgeErrorStream struct {
	err error
}

func (s edgeErrorStream) Next() (Event, bool, error) {
	return Event{}, false, s.err
}

type edgeProvider struct {
	model ProviderModel
	err   error
}

func (p edgeProvider) GetModel(string, string) (ProviderModel, error) {
	return p.model, p.err
}

func TestCoreBusErrorPaths(t *testing.T) {
	bus := NewBus()
	first := bus.Subscribe("multi")
	second := bus.Subscribe("multi")

	bus.Unsubscribe("multi", first)
	select {
	case _, ok := <-first:
		assert.False(t, ok)
	default:
		t.Fatal("expected first listener to close")
	}

	bus.Publish("multi", "visible")
	select {
	case event := <-second:
		assert.Equal(t, "visible", event.Data)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected second listener to remain active")
	}

	closed := make(chan BusEvent)
	close(closed)
	bus.safeSend(closed, BusEvent{Name: "closed"})
	assert.Positive(t, bus.Dropped())
}

func TestCoreCompactionErrorPaths(t *testing.T) {
	assert.Equal(t, 0, tokenEstimate(""))
	assert.Equal(t, 0, cutoffIndex(nil, 0))
	maxInt := int(^uint(0) >> 1)
	assert.Equal(t, maxInt, addTokenEstimate(maxInt-1, 10))
	assert.Equal(t, 7, addTokenEstimate(3, 4))

	messages := []Message{
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u1"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartSystem, System: "sys"}, {Type: PartStepFinish}}},
	}
	assert.Positive(t, tokenEstimateMessages(messages))
}

func TestCoreInstructionErrorPaths(t *testing.T) {
	resetInstructionLoaderState(t)

	assert.Empty(t, (InstructionLoader{}).SystemPaths())
	assert.Empty(t, (InstructionLoader{}).System())
	assert.Nil(t, (InstructionLoader{}).Resolve("/repo/file.txt"))

	source := &testInstructionFileSource{
		systemPaths: []string{"/repo/AGENTS.md"},
		resolved: map[string][]InstructionFileCandidate{
			"/repo/file.txt": {
				{Path: ""},
				{Path: "/repo/missing.md", Claim: true},
				{Path: "/repo/claimed.md", Claim: true},
			},
		},
		content: map[string]string{
			"/repo/claimed.md": "claimed",
		},
	}
	SetInstructionFileSource(source)
	assert.True(t, claimInstruction("/repo/claimed.md"))
	assert.Empty(t, (InstructionLoader{RootDir: "/repo"}).Resolve("/repo/file.txt"))

	restore := SetInstructionFileSource(&testInstructionFileSource{systemPaths: []string{"/next/AGENTS.md"}})
	assert.Equal(t, []string{"/next/AGENTS.md"}, (InstructionLoader{}).SystemPaths())
	restore()
	assert.Equal(t, []string{"/repo/AGENTS.md"}, (InstructionLoader{}).SystemPaths())
}

func TestCoreProcessorErrorPaths(t *testing.T) {
	previousRandom := readRandomBytes
	t.Cleanup(func() { readRandomBytes = previousRandom })
	readRandomBytes = func([]byte) (int, error) {
		return 0, errors.New("random failed")
	}
	assert.Equal(t, "part_fixed_id", generateFallbackID("part"))
	readRandomBytes = previousRandom

	ids := NewSequentialIDs()
	p := NewProcessorWithIDs("/tmp", ids)
	p.SetPermissionChecker(nil)
	user, assistant := p.BeginWithSystem("prompt", []string{"system"}, "session-1")
	assert.NotEmpty(t, user.Info.ID)
	assert.NotEmpty(t, assistant.Info.ID)
	assert.Equal(t, PartSystem, user.Parts[0].Type)

	p.ApplyEvent(&assistant, Event{Type: EventStart})
	part := Part{}
	msg := Message{Info: MessageInfo{SessionID: "session-2"}}
	p.assignPartIDs(&msg, &part)
	assert.NotEmpty(t, msg.Info.ID)
	assert.NotEmpty(t, part.ID)
	assert.Equal(t, "session-2", part.SessionID)
	assert.Equal(t, msg.Info.ID, part.MessageID)

	assert.Nil(t, toToolState(nil))
	title := "done"
	state := toToolState(map[string]any{
		"status":      "completed",
		"input":       "bad input",
		"title":       title,
		"metadata":    map[string]any{"m": 1},
		"attachments": []any{map[string]any{"a": 1}, "bad"},
		"error":       "err",
	})
	require.NotNil(t, state)
	assert.Empty(t, state.Input)
	assert.Equal(t, []map[string]any{{"a": 1}}, state.Attachments)
	assert.Equal(t, "err", state.Error)

	state = toToolState(map[string]any{"input": map[string]any{"ok": true}, "output": "done"})
	assert.Equal(t, map[string]any{"ok": true}, state.Input)
	assert.Equal(t, "done", state.Output)

	state = toToolState(map[string]any{"attachments": []map[string]any{{"b": 2}}})
	assert.Equal(t, []map[string]any{{"b": 2}}, state.Attachments)

	resultState := toToolStateFromResult(ectools.ToolResult{
		Status:      "completed",
		Input:       map[string]any{"x": 1},
		Title:       "title",
		TitleSet:    true,
		Attachments: []map[string]any{{"file": "a.txt"}},
	})
	require.NotNil(t, resultState.Title)
	assert.Equal(t, "title", *resultState.Title)
	assert.Equal(t, []map[string]any{{"file": "a.txt"}}, resultState.Attachments)
}

func TestCoreSessionOrchestratorAndSystemErrorPaths(t *testing.T) {
	var nilContext context.Context
	transcript, err := NewSessionRunner(NewProcessorWithIDs("/tmp", nil)).RunWithContext(nilContext, "prompt", NewSliceStream(nil))
	require.NoError(t, err)
	require.Len(t, transcript.Messages, 2)

	_, err = NewSessionRunner(nil).RunWithContext(context.Background(), "prompt", NewSliceStream(nil))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "processor not configured")

	streamErr := errors.New("stream failed")
	_, err = NewSessionRunner(NewProcessorWithIDs("/tmp", nil)).RunWithContext(context.Background(), "prompt", edgeErrorStream{err: streamErr})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "stream next")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = NewSessionRunner(NewProcessorWithIDs("/tmp", nil)).RunWithContext(ctx, "prompt", NewSliceStream(nil))
	require.ErrorIs(t, err, context.Canceled)

	status := NewSessionStatus(nil)
	orch := NewOrchestrator(NewSessionRunner(NewProcessorWithIDs("/tmp", nil)), status, &Compactor{Options: CompactionOptions{}})
	transcript, err = orch.RunWithContext(nilContext, RunOptions{SessionID: "nil-context", Stream: NewSliceStream(nil), Prompt: "prompt"})
	require.NoError(t, err)
	require.Len(t, transcript.Messages, 2)
	assert.Equal(t, StatusIdle, status.Get("nil-context").Type)

	orch.Provider = edgeProvider{err: errors.New("provider failed")}
	_, err = orch.RunWithContext(context.Background(), RunOptions{SessionID: "s1", Stream: NewSliceStream(nil), Prompt: "prompt"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "resolve model")
	assert.Equal(t, StatusIdle, status.Get("s1").Type)

	store := NewStore()
	sessionID := "compact-direct"
	huge := strings.Repeat("x", compactMinimumTokens*5)
	store.Append(sessionID,
		Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u1"}}},
		Message{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: huge}}},
		Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u2"}}},
		Message{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "a2"}}},
		Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u3"}}},
	)
	orch = &Orchestrator{
		Compaction: &Compactor{Options: CompactionOptions{Auto: true}},
		Store:      store,
		Summary:    &SummaryGenerator{MaxLines: 4},
	}
	orch.compactStoredMessages(sessionID)
	compacted := store.Messages(sessionID)
	require.NotEmpty(t, compacted)
	assert.True(t, compacted[0].Info.Summary)

	noSummaryStore := NewStore()
	noSummaryStore.Append("no-summary", Message{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u"}}})
	(&Orchestrator{Compaction: &Compactor{Options: CompactionOptions{Auto: true}}, Store: noSummaryStore}).compactStoredMessages("no-summary")
	assert.Len(t, noSummaryStore.Messages("no-summary"), 1)

	resetSystemPromptSource(t)

	assert.Nil(t, SystemPromptEnvironment(ProviderModel{ProviderID: "p", ModelID: "m"}, t.TempDir(), 10))

	restoreEnv := SetSystemEnvironmentSource(testSystemEnvironmentSource{"env prompt"})
	assert.Equal(t, []string{"env prompt"}, SystemPromptEnvironment(ProviderModel{ProviderID: "p", ModelID: "m"}, t.TempDir(), 10))
	restoreEnv()
	assert.Nil(t, SystemPromptEnvironment(ProviderModel{ProviderID: "p", ModelID: "m"}, t.TempDir(), 10))

	restore := SetSystemPromptSource(testSystemPromptSource{"source prompt"})
	assert.Equal(t, []string{"source prompt"}, SystemPromptProvider(ProviderModel{ProviderID: "p", ModelID: "m"}))
	restore()
	assert.Nil(t, SystemPromptProvider(ProviderModel{ProviderID: "p", ModelID: "m"}))
}

func TestCoreSummaryAndRetryFallbacks(t *testing.T) {
	generated := SummaryGenerator{}.Generate([]Message{{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "hello"}}}})
	assert.Contains(t, generated, "Summary:")
	assert.Equal(t, "short", truncateSummary("short", 10))
	assert.Equal(t, "ééé", truncateSummary("ééé", 4))
	assert.Empty(t, lastText(nil, RoleUser))
	assert.Empty(t, collectTexts([]Message{{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartReason, Text: "skip"}}}}, RoleUser, 2))

	_, ok := retryDelayFromHeaders(map[string]string{"retry-after": "not a date"})
	assert.False(t, ok)
}

func TestCoreCompactionAndChannelFallbacks(t *testing.T) {
	huge := strings.Repeat("x", compactMinimumTokens*5)
	messages := []Message{
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "only user"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: huge}}},
	}
	changed, next := (&Compactor{Options: CompactionOptions{Auto: true}}).Compact(messages, SummaryGenerator{})
	assert.False(t, changed)
	assert.Len(t, next, len(messages))

	pruneMessages := []Message{
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartTool, Tool: "grep", State: &ToolState{Status: "completed", Output: huge}}}},
		{Info: MessageInfo{Role: RoleAssistant, Summary: true}, Parts: []Part{{Type: PartText, Text: "summary"}}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u2"}}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u3"}}},
	}
	assert.False(t, pruneToolOutputs(pruneMessages))

	stream := NewChannelLLMStreamWithTimeout(0)
	done := make(chan struct{})
	go func() {
		ev, ok, err := stream.Next()
		assert.NoError(t, err)
		assert.True(t, ok)
		assert.Equal(t, "wake", ev.Text)
		close(done)
	}()
	time.Sleep(10 * time.Millisecond)
	stream.Push(LLMEvent{Type: LLMText, Text: "wake"})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("blocking stream did not wake")
	}
}
