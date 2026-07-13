package orchestrator

import (
	"strconv"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/stretchr/testify/assert"
)

func TestUsageTracker(t *testing.T) {
	u := NewUsageTracker()

	t.Run("RecordToolUsage", func(t *testing.T) {
		called := false
		u.OnToolUsage(func(e agent.ToolEvent, h []agent.ToolEvent) {
			called = true
			assert.Equal(t, "test-tool", e.ToolName)
			assert.Len(t, h, 1)
		})

		u.RecordToolUsage(agent.ToolEvent{ToolName: "test-tool"})
		assert.True(t, called)
	})

	t.Run("RecordTokenUsage", func(t *testing.T) {
		usage := &agent.ChatCompletionUsage{
			PromptTokens:     10,
			CompletionTokens: 20,
			TotalTokens:      30,
		}
		u.RecordTokenUsage("stage1", usage, "gpt-4")
		u.RecordTokenUsage("stage2", nil, "gpt-4") // Should be ignored

		records, totals := u.GetTokenUsageSummary()
		assert.Len(t, records, 1)
		assert.Equal(t, 30, totals.TotalTokens)
	})

	t.Run("GetToolUsage", func(t *testing.T) {
		usage := u.GetToolUsage()
		assert.Len(t, usage, 1)
	})

	t.Run("RecordToolUsage replaces in-progress invocation", func(t *testing.T) {
		u2 := NewUsageTracker()
		agentID := 0
		started := agent.ToolEvent{
			AgentID:    &agentID,
			AgentLabel: "agent-1",
			ToolName:   "search_web",
			Arguments:  map[string]any{"query": "latest AI news"},
			Success:    true,
		}
		completed := started
		completed.DurationMs = 125
		completed.ResultPreview = "Found results"
		completed.Sources = []agent.SourceReference{{URL: "https://example.com", Title: "Example"}}

		u2.RecordToolUsage(started)
		u2.RecordToolUsage(completed)

		usage := u2.GetToolUsage()
		assert.Len(t, usage, 1)
		assert.Equal(t, int64(125), usage[0].DurationMs)
		assert.Equal(t, "Found results", usage[0].ResultPreview)
		assert.Len(t, usage[0].Sources, 1)
	})

	t.Run("RecordToolUsage replaces by invocation id when arguments are normalized later", func(t *testing.T) {
		u2 := NewUsageTracker()
		agentID := 0
		started := agent.ToolEvent{
			InvocationID: "call-42",
			AgentID:      &agentID,
			AgentLabel:   "agent-1",
			ToolName:     "search_web",
			Arguments:    `{"query":"latest AI news"}`,
			Success:      true,
		}
		completed := agent.ToolEvent{
			InvocationID:  "call-42",
			AgentID:       &agentID,
			AgentLabel:    "agent-1",
			ToolName:      "search_web",
			Arguments:     map[string]any{"query": "latest AI news"},
			Success:       true,
			DurationMs:    321,
			ResultPreview: "Found results",
		}

		u2.RecordToolUsage(started)
		u2.RecordToolUsage(completed)

		usage := u2.GetToolUsage()
		assert.Len(t, usage, 1)
		assert.Equal(t, int64(321), usage[0].DurationMs)
		assert.Equal(t, "Found results", usage[0].ResultPreview)
	})

	t.Run("RecordToolUsage clears invocation index on reset", func(t *testing.T) {
		u2 := NewUsageTracker()
		u2.RecordToolUsage(agent.ToolEvent{
			InvocationID: "call-reset",
			ToolName:     "search_web",
			Status:       "running",
			Success:      true,
		})
		u2.ResetToolUsage()
		u2.RecordToolUsage(agent.ToolEvent{
			InvocationID:  "call-reset",
			ToolName:      "search_web",
			Status:        "completed",
			Success:       true,
			ResultPreview: "after reset",
		})

		usage := u2.GetToolUsage()
		assert.Len(t, usage, 1)
		assert.Equal(t, "after reset", usage[0].ResultPreview)
	})

	t.Run("RecordToolUsage legacy event replaces matching invocation event", func(t *testing.T) {
		u2 := NewUsageTracker()
		agentID := 0
		args := map[string]any{"query": "latest AI news"}
		u2.RecordToolUsage(agent.ToolEvent{
			InvocationID: "call-legacy",
			AgentID:      &agentID,
			AgentLabel:   "agent-1",
			ToolName:     "search_web",
			Arguments:    args,
			Status:       "running",
			Success:      true,
		})
		u2.RecordToolUsage(agent.ToolEvent{
			AgentID:       &agentID,
			AgentLabel:    "agent-1",
			ToolName:      "search_web",
			Arguments:     args,
			Status:        "completed",
			Success:       true,
			DurationMs:    456,
			ResultPreview: "legacy completion",
		})

		usage := u2.GetToolUsage()
		assert.Len(t, usage, 1)
		assert.Empty(t, usage[0].InvocationID)
		assert.Equal(t, int64(456), usage[0].DurationMs)
		assert.Equal(t, "legacy completion", usage[0].ResultPreview)
	})

	t.Run("Resets", func(t *testing.T) {
		u.ResetTokenUsage()
		records, _ := u.GetTokenUsageSummary()
		assert.Empty(t, records)

		u.ResetToolUsage()
		assert.Empty(t, u.GetToolUsage())
	})

	t.Run("OnToolUsage Unsubscribe", func(t *testing.T) {
		unsubscribe := u.OnToolUsage(func(e agent.ToolEvent, h []agent.ToolEvent) {})
		assert.NotNil(t, unsubscribe)
		unsubscribe()
	})

	t.Run("OnToolUsage Unsubscribe Idempotent", func(t *testing.T) {
		u2 := NewUsageTracker()
		calls := 0
		unsubscribe := u2.OnToolUsage(func(e agent.ToolEvent, h []agent.ToolEvent) {
			calls++
		})

		unsubscribe()
		unsubscribe() // second call should be a no-op

		u2.RecordToolUsage(agent.ToolEvent{ToolName: "after-unsubscribe"})
		assert.Equal(t, 0, calls)
	})

	t.Run("OnToolUsage Stale Index Bug (Hardening TF-0301)", func(t *testing.T) {
		u2 := NewUsageTracker()

		called1 := 0
		called2 := 0
		called3 := 0

		unsub1 := u2.OnToolUsage(func(e agent.ToolEvent, h []agent.ToolEvent) { called1++ })
		unsub2 := u2.OnToolUsage(func(e agent.ToolEvent, h []agent.ToolEvent) { called2++ })
		unsub3 := u2.OnToolUsage(func(e agent.ToolEvent, h []agent.ToolEvent) { called3++ })

		// Record once, all 3 should be called
		u2.RecordToolUsage(agent.ToolEvent{ToolName: "t1"})
		assert.Equal(t, 1, called1)
		assert.Equal(t, 1, called2)
		assert.Equal(t, 1, called3)

		// Unsubscribe the middle one (proves unique ID works, not index shifting)
		unsub2()

		// Record again, 1 and 3 should increment, 2 should not
		u2.RecordToolUsage(agent.ToolEvent{ToolName: "t2"})
		assert.Equal(t, 2, called1)
		assert.Equal(t, 1, called2) // didn't change
		assert.Equal(t, 2, called3)

		// Unsubscribe the rest
		unsub1()
		unsub3()

		u2.RecordToolUsage(agent.ToolEvent{ToolName: "t3"})
		assert.Equal(t, 2, called1)
		assert.Equal(t, 1, called2)
		assert.Equal(t, 2, called3)
	})

	t.Run("ResetAll", func(t *testing.T) {
		u.ResetAll()
		assert.Empty(t, u.GetToolUsage())
		records, _ := u.GetTokenUsageSummary()
		assert.Empty(t, records)
	})

	t.Run("Token summary returns copy", func(t *testing.T) {
		u2 := NewUsageTracker()
		u2.RecordTokenUsage("stage", &agent.ChatCompletionUsage{
			PromptTokens:     3,
			CompletionTokens: 4,
			TotalTokens:      7,
		}, "gpt-4")

		records, _ := u2.GetTokenUsageSummary()
		assert.Len(t, records, 1)
		records[0].TotalTokens = 999

		recordsAgain, totals := u2.GetTokenUsageSummary()
		assert.Equal(t, 7, recordsAgain[0].TotalTokens)
		assert.Equal(t, 7, totals.TotalTokens)
	})
}

var benchmarkToolUsage []agent.ToolEvent

func BenchmarkUsageTrackerRecordToolUsage(b *testing.B) {
	b.Run("invocation_id_no_listener", func(b *testing.B) {
		for b.Loop() {
			tracker := NewUsageTracker()
			for i := range 160 {
				invocationID := "call-" + strconv.Itoa(i)
				tracker.RecordToolUsage(agent.ToolEvent{
					InvocationID: invocationID,
					AgentLabel:   "agent",
					ToolName:     "search_web",
					Arguments:    `{"query":"latest taskforce progress"}`,
					Status:       "running",
					Success:      true,
				})
				tracker.RecordToolUsage(agent.ToolEvent{
					InvocationID:  invocationID,
					AgentLabel:    "agent",
					ToolName:      "search_web",
					Arguments:     map[string]any{"query": "latest taskforce progress"},
					Status:        "completed",
					Success:       true,
					DurationMs:    int64(i * 3),
					ResultPreview: "result",
				})
			}
			benchmarkToolUsage = tracker.GetToolUsage()
		}
	})

	b.Run("invocation_id_running_completed", func(b *testing.B) {
		for b.Loop() {
			tracker := NewUsageTracker()
			tracker.OnToolUsage(func(agent.ToolEvent, []agent.ToolEvent) {})
			for i := range 160 {
				invocationID := "call-" + strconv.Itoa(i)
				tracker.RecordToolUsage(agent.ToolEvent{
					InvocationID: invocationID,
					AgentLabel:   "agent",
					ToolName:     "search_web",
					Arguments:    `{"query":"latest taskforce progress"}`,
					Status:       "running",
					Success:      true,
				})
				tracker.RecordToolUsage(agent.ToolEvent{
					InvocationID:  invocationID,
					AgentLabel:    "agent",
					ToolName:      "search_web",
					Arguments:     map[string]any{"query": "latest taskforce progress"},
					Status:        "completed",
					Success:       true,
					DurationMs:    int64(i * 3),
					ResultPreview: "result",
				})
			}
			benchmarkToolUsage = tracker.GetToolUsage()
		}
	})

	b.Run("legacy_argument_matching", func(b *testing.B) {
		for b.Loop() {
			tracker := NewUsageTracker()
			tracker.OnToolUsage(func(agent.ToolEvent, []agent.ToolEvent) {})
			for i := range 160 {
				args := map[string]any{"query": "latest taskforce progress " + strconv.Itoa(i)}
				tracker.RecordToolUsage(agent.ToolEvent{
					AgentLabel: "agent",
					ToolName:   "search_web",
					Arguments:  args,
					Status:     "running",
					Success:    true,
				})
				tracker.RecordToolUsage(agent.ToolEvent{
					AgentLabel:    "agent",
					ToolName:      "search_web",
					Arguments:     args,
					Status:        "completed",
					Success:       true,
					DurationMs:    int64(i * 3),
					ResultPreview: "result",
				})
			}
			benchmarkToolUsage = tracker.GetToolUsage()
		}
	})
}

func TestUsageTrackerCoverageGapPaths(t *testing.T) {
	tracker := NewUsageTracker()

	t.Run("tool usage listener receives snapshots and unsubscribes once", func(t *testing.T) {
		calls := 0
		unsubscribe := tracker.OnToolUsage(func(event agent.ToolEvent, history []agent.ToolEvent) {
			calls++
			if len(history) != calls {
				t.Fatalf("expected history length %d, got %d", calls, len(history))
			}
			if event.ToolName == "" {
				t.Fatal("expected tool event payload")
			}
		})

		tracker.RecordToolUsage(agent.ToolEvent{ToolName: "grep"})
		tracker.RecordToolUsage(agent.ToolEvent{ToolName: "edit"})
		unsubscribe()
		unsubscribe()

		if calls != 2 {
			t.Fatalf("expected two listener calls, got %d", calls)
		}
		if got := tracker.GetToolUsage(); len(got) != 2 {
			t.Fatalf("expected two recorded tool events, got %d", len(got))
		}
	})

	t.Run("token usage summary ignores nil usage and reset helpers clear state", func(t *testing.T) {
		tracker.RecordTokenUsage("stage", nil, "model")
		tracker.RecordTokenUsage("stage", &agent.ChatCompletionUsage{
			PromptTokens:     1,
			CompletionTokens: 2,
			TotalTokens:      3,
		}, "model")

		records, totals := tracker.GetTokenUsageSummary()
		if len(records) != 1 || totals.TotalTokens != 3 {
			t.Fatalf("unexpected token summary: records=%d totals=%+v", len(records), totals)
		}

		tracker.ResetToolUsage()
		tracker.ResetTokenUsage()
		tracker.ResetAll()
		if len(tracker.GetToolUsage()) != 0 {
			t.Fatal("expected tool usage reset")
		}
		records, totals = tracker.GetTokenUsageSummary()
		if len(records) != 0 || totals.TotalTokens != 0 {
			t.Fatal("expected token usage reset")
		}
	})
}
