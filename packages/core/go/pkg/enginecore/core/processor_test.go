package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	tools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProcessorCoverageGapPaths(t *testing.T) {
	p := NewProcessorWithIDs("/tmp", nil)

	t.Run("processes reasoning and tool events", func(t *testing.T) {
		events := []Event{
			{Type: EventText, Text: "answer", Reasoning: "because"},
			{
				Type: EventTool,
				Tool: &ToolCall{Name: "read", Args: map[string]any{"filePath": "a.txt"}},
				ToolState: map[string]any{
					"status": "completed",
					"output": "file contents",
				},
			},
			{
				Type: EventTool,
				Tool: &ToolCall{Name: "list", Args: map[string]any{}},
			},
			{Type: EventFinishStep, FinishStep: &FinishStepData{FinishReason: "stop", Usage: &Usage{InputTokens: 2, OutputTokens: 3}}},
		}

		transcript, err := p.Process("hello", events)
		require.NoError(t, err)
		assert.Len(t, transcript.Messages, 2)
		assert.Len(t, transcript.Messages[1].Parts, 5)
		assert.Equal(t, PartReason, transcript.Messages[1].Parts[1].Type)
		assert.Equal(t, PartTool, transcript.Messages[1].Parts[2].Type)
		assert.NotNil(t, transcript.Messages[1].Parts[2].State)
		assert.Equal(t, "stop", transcript.Messages[1].Info.Finish)
	})

	t.Run("executes registered tools against cwd", func(t *testing.T) {
		tmpDir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "a.txt"), []byte("hello\nworld"), 0o600))

		p := NewProcessorWithIDs(tmpDir, nil)
		p.SetPath(tmpDir, tmpDir)
		transcript, err := p.Process("read file", []Event{
			{Type: EventTool, Tool: &ToolCall{Name: "read", Args: map[string]any{"filePath": "a.txt"}}},
			{Type: EventText, Text: "done"},
			{Type: EventFinishStep, FinishStep: &FinishStepData{FinishReason: "stop"}},
		})
		require.NoError(t, err)
		require.Len(t, transcript.Messages, 2)

		var toolPart *Part
		for i := range transcript.Messages[1].Parts {
			if transcript.Messages[1].Parts[i].Type == PartTool {
				toolPart = &transcript.Messages[1].Parts[i]
				break
			}
		}
		require.NotNil(t, toolPart)
		require.NotNil(t, toolPart.State)
		assert.Equal(t, "completed", toolPart.State.Status)
		assert.Contains(t, toolPart.State.Output, "hello")
	})

	t.Run("surfaces not-found errors for legacy port tool names", func(t *testing.T) {
		tmpDir := t.TempDir()
		p := NewProcessorWithIDs(tmpDir, nil)
		p.SetPath(tmpDir, tmpDir)

		transcript, err := p.Process("list dir", []Event{
			{Type: EventTool, Tool: &ToolCall{Name: "ls", Args: map[string]any{"path": "."}}},
			{Type: EventText, Text: "listed"},
			{Type: EventFinishStep},
		})
		require.NoError(t, err)
		require.NotNil(t, transcript.Messages[1].Parts[0].State)
		assert.Equal(t, "error", transcript.Messages[1].Parts[0].State.Status)
		assert.Contains(t, transcript.Messages[1].Parts[0].State.Error, "tool not found: ls")
	})

	t.Run("records stream errors on the assistant message", func(t *testing.T) {
		p := NewProcessorWithIDs(t.TempDir(), nil)
		streamErr := errors.New("boom")
		transcript, err := p.Process("error", []Event{
			{Type: EventError, Err: streamErr},
			{Type: EventFinishStep},
		})
		require.NoError(t, err)
		require.NotNil(t, transcript.Messages[1].Info.Error)
		assert.Equal(t, "Error: boom", transcript.Messages[1].Info.Error.Data["message"])
	})
}

func TestProcessorSettersAndClone(t *testing.T) {
	p := NewProcessorWithIDs("/tmp", nil)

	p.SetPath("/work", "/")
	user, assistant := p.Begin("prompt", "s1")
	assert.Equal(t, "/work", user.Info.Path.Cwd)
	assert.Equal(t, "/", assistant.Info.Path.Root)

	p.SetPath("", "")
	user, _ = p.Begin("prompt", "s1")
	assert.Nil(t, user.Info.Path)

	p.SetContext(nilContext())
	assert.NotNil(t, p.ctx.Ctx)
	type processorContextKey string
	customCtx := context.WithValue(context.Background(), processorContextKey("k"), "v")
	p.SetContext(customCtx)
	assert.Equal(t, "v", p.ctx.Ctx.Value(processorContextKey("k")))

	p.SetQuestionAnswer("yes")
	assert.True(t, p.ctx.QuestionAnswerSet)
	assert.Equal(t, "yes", p.ctx.QuestionAnswer)
	p.SetQuestionAnswer("")
	assert.False(t, p.ctx.QuestionAnswerSet)

	p.ctx.ReadFiles["a.txt"] = true
	p.ctx.Todo.Set([]map[string]any{{
		"id":       "1",
		"content":  "original",
		"status":   "pending",
		"priority": "high",
	}})
	clone := p.Clone()
	p.ctx.ReadFiles["b.txt"] = true
	assert.True(t, clone.ctx.ReadFiles["a.txt"])
	assert.False(t, clone.ctx.ReadFiles["b.txt"])

	p.ctx.Todo.Set([]map[string]any{{
		"id":       "2",
		"content":  "updated original",
		"status":   "pending",
		"priority": "high",
	}})
	clone.ctx.Todo.Set([]map[string]any{{
		"id":       "3",
		"content":  "updated clone",
		"status":   "pending",
		"priority": "high",
	}})

	assert.Equal(t, "updated original", p.ctx.Todo.Get()[0]["content"])
	assert.Equal(t, "updated clone", clone.ctx.Todo.Get()[0]["content"])
}

func TestProcessorCloneCreatesTodoStoreWhenMissing(t *testing.T) {
	p := NewProcessorWithIDs("/tmp", nil)
	p.ctx.Todo = nil

	clone := p.Clone()
	require.NotNil(t, clone.ctx.Todo)

	tools.ExecuteTool(clone.ctx, "todowrite", map[string]any{
		"todos": []any{map[string]any{
			"id":       "1",
			"content":  "task",
			"status":   "pending",
			"priority": "high",
		}},
	})
	assert.Equal(t, "task", clone.ctx.Todo.Get()[0]["content"])
}

func TestProcessor_Begin(t *testing.T) {
	p := NewProcessorWithIDs("/tmp", nil)
	user, assistant := p.Begin("prompt", "s1")

	assert.Equal(t, RoleUser, user.Info.Role)
	assert.Equal(t, RoleAssistant, assistant.Info.Role)
	assert.Equal(t, "s1", user.Info.SessionID)
}

func TestProcessor_Process(t *testing.T) {
	p := NewProcessorWithIDs("/tmp", nil)
	events := []Event{
		{Type: EventText, Text: "hi"},
		{Type: EventFinishStep},
	}

	transcript, err := p.Process("hello", events)
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
	assert.Equal(t, "hello", transcript.Messages[0].Parts[0].Text)
	assert.Equal(t, "hi", transcript.Messages[1].Parts[0].Text)
}

func TestProcessorClampsUsageTokens(t *testing.T) {
	p := NewProcessorWithIDs("/tmp", nil)
	transcript, err := p.Process("hello", []Event{
		{Type: EventFinishStep, FinishStep: &FinishStepData{
			Usage: &Usage{
				InputTokens:     -10,
				OutputTokens:    -20,
				ReasoningTokens: -30,
				CacheRead:       40,
				CacheWrite:      -50,
			},
		}},
	})
	require.NoError(t, err)
	require.Len(t, transcript.Messages, 2)
	infoTokens := transcript.Messages[1].Info.Tokens
	require.NotNil(t, infoTokens)
	assert.Equal(t, 0, infoTokens.Input)
	assert.Equal(t, 0, infoTokens.Output)
	assert.Equal(t, 0, infoTokens.Reasoning)
	assert.Equal(t, 40, infoTokens.Cache.Read)
	assert.Equal(t, 0, infoTokens.Cache.Write)

	require.Len(t, transcript.Messages[1].Parts, 1)
	partTokens := transcript.Messages[1].Parts[0].Tokens
	require.NotNil(t, partTokens)
	assert.Equal(t, infoTokens, partTokens)
}

func TestToToolState(t *testing.T) {
	raw := map[string]any{
		"status": "completed",
		"output": "done",
		"title":  "Read file",
		"metadata": map[string]any{
			"preview": "done",
		},
		"attachments": []any{
			map[string]any{"url": "u1"},
		},
		"error": "none",
	}
	state := toToolState(raw)
	assert.Equal(t, "completed", state.Status)
	assert.Equal(t, "done", state.Output)
	assert.Equal(t, "Read file", *state.Title)
	assert.Equal(t, "done", state.Metadata["preview"])
	assert.Equal(t, "none", state.Error)
	assert.Len(t, state.Attachments, 1)
	assert.Equal(t, "u1", state.Attachments[0]["url"])

	assert.Nil(t, toToolState(nil))

	state = toToolState(map[string]any{
		"input":       "not-a-map",
		"attachments": []map[string]any{{"url": "u2"}},
	})
	assert.NotNil(t, state.Input)
	assert.Len(t, state.Attachments, 1)
	assert.Equal(t, "u2", state.Attachments[0]["url"])
}

func nilContext() context.Context {
	return nil
}
