package core

import (
	"strings"
	"testing"
)

func TestEnginecoreCoreCoverageGapPaths(t *testing.T) {
	t.Run("compactor compacts large histories and notifies bus", func(t *testing.T) {
		bus := NewBus()
		events := bus.Subscribe("session.compacted")
		compactor := &Compactor{Options: CompactionOptions{Auto: true}, Bus: bus}
		huge := strings.Repeat("a", compactMinimumTokens*5)
		messages := []Message{
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "first request"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: huge}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "second request"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "ok"}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "third request"}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{{Type: PartText, Text: "done"}}},
		}

		compacted, next := compactor.Compact(messages, HeuristicSummaryGenerator{MaxLines: 10})
		if !compacted || len(next) >= len(messages) {
			t.Fatalf("expected compacted transcript to shrink, got len=%d compacted=%v", len(next), compacted)
		}
		compactor.NotifyCompacted("session-1")
		select {
		case event := <-events:
			payload, ok := event.Data.(map[string]any)
			if !ok || payload["sessionID"] != "session-1" {
				t.Fatalf("unexpected compaction event: %#v", event.Data)
			}
		default:
			t.Fatal("expected compaction notification event")
		}
	})

	t.Run("compaction helper edge functions", func(t *testing.T) {
		if tokenEstimate("") != 0 {
			t.Fatal("expected zero token estimate for empty string")
		}
		if tokenEstimateMessages(nil) != 0 {
			t.Fatal("expected zero token estimate for nil messages")
		}
		messages := []Message{
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "u1"}}},
			{Info: MessageInfo{Role: RoleAssistant, Summary: true}, Parts: []Part{{Type: PartText, Text: "summary"}}},
		}
		if cutoff := cutoffIndex(messages, 2); cutoff != 0 {
			t.Fatalf("expected zero cutoff for short history, got %d", cutoff)
		}
	})
}
