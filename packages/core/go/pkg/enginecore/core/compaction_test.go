package core

import (
	"strings"
	"testing"
	"time"
)

func TestCompactionCoverageGapPaths(t *testing.T) {
	t.Run("prune tool outputs respects options flag", func(t *testing.T) {
		compactor := &Compactor{Options: CompactionOptions{Prune: false}}
		huge := strings.Repeat("a", 80000)
		messages := []Message{
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-old"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{
				Type:  PartTool,
				Tool:  "grep",
				State: &ToolState{Status: "completed", Output: huge},
			}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-mid"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{
				Type:  PartTool,
				Tool:  "grep",
				State: &ToolState{Status: "completed", Output: huge},
			}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-recent-1"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "a-recent-1"}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u-recent-2"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "a-recent-2"}}},
		}
		if compactor.PruneToolOutputs(messages) {
			t.Fatal("expected prune disabled compactor to skip pruning")
		}

		compactor.Options.Prune = true
		if !compactor.PruneToolOutputs(messages) {
			t.Fatal("expected prune enabled compactor to prune large tool outputs")
		}
	})

	t.Run("token estimate messages handles overflow guard", func(t *testing.T) {
		messages := []Message{{
			Info: MessageInfo{Role: RoleAssistant},
			Parts: []Part{{
				Type: PartText,
				Text: strings.Repeat("x", 1<<30),
			}},
		}}
		if got := tokenEstimateMessages(messages); got <= 0 {
			t.Fatalf("expected positive token estimate, got %d", got)
		}
	})

	t.Run("prune protects skill tool outputs", func(t *testing.T) {
		huge := strings.Repeat("s", 80000)
		messages := []Message{
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u1"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{
				Type: PartTool,
				Tool: "skill",
				State: &ToolState{
					Status: "completed",
					Output: huge,
				},
			}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u2"}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u3"}}},
		}
		if pruneToolOutputs(messages) {
			t.Fatal("expected protected skill output to remain unpruned")
		}
	})
}

func TestCompactionPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("compact returns early for disabled auto compaction and small histories", func(t *testing.T) {
		disabled := &Compactor{Options: CompactionOptions{Auto: false}}
		messages := []Message{{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "hello"}}}}
		changed, next := disabled.Compact(messages, HeuristicSummaryGenerator{})
		if changed || len(next) != len(messages) {
			t.Fatal("expected disabled compactor to leave messages unchanged")
		}

		enabled := &Compactor{Options: CompactionOptions{Auto: true}}
		changed, next = enabled.Compact(nil, HeuristicSummaryGenerator{})
		if changed || next != nil {
			t.Fatal("expected empty messages to skip compaction")
		}

		smallHistory := []Message{
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "short"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "reply"}}},
		}
		changed, next = enabled.Compact(smallHistory, HeuristicSummaryGenerator{})
		if changed || len(next) != len(smallHistory) {
			t.Fatal("expected small histories below token threshold to skip compaction")
		}
	})

	t.Run("compact skips when cutoff index is zero", func(t *testing.T) {
		huge := strings.Repeat("x", 80000)
		messages := []Message{
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "only-recent"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartTool, Tool: "grep", State: &ToolState{Status: "completed", Output: huge}}}},
		}
		enabled := &Compactor{Options: CompactionOptions{Auto: true}}
		changed, next := enabled.Compact(messages, HeuristicSummaryGenerator{})
		if changed || len(next) != len(messages) {
			t.Fatal("expected histories without enough recent turns to skip compaction")
		}
	})
}

func TestCompactorCompact(t *testing.T) {
	compactor := &Compactor{Options: CompactionOptions{Auto: true}}
	summary := HeuristicSummaryGenerator{MaxLines: 10}

	huge := strings.Repeat("a", compactMinimumTokens*5)
	messages := []Message{
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "first request"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: huge}}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "second request"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "ok"}}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "third request"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "done"}}},
	}

	compacted, next := compactor.Compact(messages, summary)
	if !compacted {
		t.Fatalf("expected compaction")
	}
	if len(next) >= len(messages) {
		t.Fatalf("expected messages to shrink")
	}
	if len(next) < 2 || !next[0].Info.Summary {
		t.Fatalf("expected summary message at start")
	}
}

func TestCompactorCompactNoopsAndNotify(t *testing.T) {
	messages := []Message{{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "small"}}}}
	compactor := &Compactor{Options: CompactionOptions{Auto: true}}
	if compacted, _ := compactor.Compact(nil, HeuristicSummaryGenerator{}); compacted {
		t.Fatalf("empty messages should not compact")
	}
	if compacted, next := compactor.Compact(messages, HeuristicSummaryGenerator{}); compacted || len(next) != len(messages) {
		t.Fatalf("small messages should not compact")
	}

	bus := NewBus()
	events := bus.Subscribe("session.compacted")
	(&Compactor{Bus: bus}).NotifyCompacted("session-1")
	select {
	case event := <-events:
		payload, ok := event.Data.(map[string]any)
		if !ok || payload["sessionID"] != "session-1" {
			t.Fatalf("unexpected compaction event: %#v", event.Data)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected compaction event")
	}
	(&Compactor{}).NotifyCompacted("session-2")
}

func TestCompactorOverflowEdgeCases(t *testing.T) {
	if (&Compactor{Options: CompactionOptions{}}).IsOverflow(CompactionInfo{ModelContext: 100}) {
		t.Fatalf("disabled auto compaction should not overflow")
	}
	if (&Compactor{Options: CompactionOptions{Auto: true}}).IsOverflow(CompactionInfo{}) {
		t.Fatalf("missing model context should not overflow")
	}
	info := CompactionInfo{
		InputTokens:  90,
		OutputTokens: 5,
		CacheRead:    6,
		ModelContext: 200,
		ModelOutput:  100,
		ModelInput:   100,
		OutputMax:    10,
	}
	if !(&Compactor{Options: CompactionOptions{Auto: true}}).IsOverflow(info) {
		t.Fatalf("explicit model input should be used for overflow")
	}
}

func TestCompactorOverflowFalse(t *testing.T) {
	compactor := &Compactor{Options: CompactionOptions{Auto: true}}
	info := CompactionInfo{
		InputTokens:  100_000,
		OutputTokens: 10_000,
		CacheRead:    0,
		ModelContext: 200_000,
		ModelOutput:  32_000,
	}
	if compactor.IsOverflow(info) {
		t.Fatalf("expected no overflow")
	}
}

func TestCompactorOverflowTrue(t *testing.T) {
	compactor := &Compactor{Options: CompactionOptions{Auto: true}}
	info := CompactionInfo{
		InputTokens:  75_000,
		OutputTokens: 5_000,
		CacheRead:    0,
		ModelContext: 100_000,
		ModelOutput:  32_000,
	}
	if !compactor.IsOverflow(info) {
		t.Fatalf("expected overflow")
	}
}

func TestCompactorPrune(t *testing.T) {
	compactor := &Compactor{Options: CompactionOptions{Prune: true}}

	// Emojis are non-ASCII and count as 1 token each in our simple estimate
	largeOutput := strings.Repeat("😀", pruneMinimum+1)
	messages := []Message{
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u1"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{
			{Type: PartTool, Tool: "grep", State: &ToolState{Status: "completed", Output: largeOutput}},
		}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u2"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "a2"}}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u3"}}},
	}

	pruned := compactor.PruneToolOutputs(messages)
	if !pruned {
		t.Errorf("expected pruning of large tool output")
	}
	if messages[1].Parts[0].State.Output != "" {
		t.Errorf("expected output to be cleared")
	}
}

func TestPruneToolOutputsSkipsProtectedAndRecentOutputs(t *testing.T) {
	largeOutput := strings.Repeat("x", pruneMinimum*4)
	messages := []Message{
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u1"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{
			{Type: PartTool, Tool: "skill", State: &ToolState{Status: "completed", Output: largeOutput}},
			{Type: PartTool, Tool: "grep", State: &ToolState{Status: "running", Output: largeOutput}},
			{Type: PartTool, Tool: "grep", State: &ToolState{Status: "completed"}},
		}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u2"}}},
		{Info: MessageInfo{Role: RoleAssistant, Summary: true}, Parts: []Part{{Type: PartText, Text: "summary"}}},
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u3"}}},
	}
	if pruneToolOutputs(messages) {
		t.Fatalf("protected, running, empty, and summary-bounded outputs should not be pruned")
	}
}
