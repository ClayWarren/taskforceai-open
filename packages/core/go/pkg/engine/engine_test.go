package engine

import (
	"context"
	"testing"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecorepermission "github.com/TaskForceAI/core/pkg/enginecore/permission"
	enginecoreprotocol "github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type stubInstruction struct{}

func (stubInstruction) Resolve(string) []enginecoreprotocol.InstructionEntry { return nil }

type stubCostCalculator struct{}

func (stubCostCalculator) FromUsage(enginecore.Usage, map[string]any) float64 { return 1 }

func TestEngineCoverageGapPaths(t *testing.T) {
	t.Run("run stream rejects uninitialized engine", func(t *testing.T) {
		var engine *Engine
		_, err := engine.RunStream(context.Background(), RunInput{SessionID: "s", Prompt: "p"})
		if err == nil {
			t.Fatal("expected uninitialized engine error")
		}
	})
}

func TestEnginePushTo95CoverageGapPaths(t *testing.T) {
	t.Run("new applies optional engine dependencies", func(t *testing.T) {
		status := &enginecore.SessionStatus{}
		compaction := &enginecore.Compactor{Options: enginecore.CompactionOptions{Auto: true}}
		summary := enginecore.HeuristicSummaryGenerator{MaxLines: 4}
		perm := &enginecorepermission.RuleBasedPermission{
			DefaultAction: enginecorepermission.PermissionAllow,
		}
		eng := New(Options{
			Cwd:         t.TempDir(),
			Root:        t.TempDir(),
			Permission:  perm,
			Instruction: stubInstruction{},
			Cost:        stubCostCalculator{},
			Status:      status,
			Compaction:  compaction,
			Summary:     &summary,
		})
		if eng == nil || eng.processor == nil || eng.orchestrator == nil {
			t.Fatal("expected initialized engine")
		}
	})

	t.Run("run stream rejects nil orchestrator engine", func(t *testing.T) {
		eng := &Engine{processor: enginecore.NewProcessorWithIDs("", nil)}
		_, err := eng.RunStream(context.Background(), RunInput{SessionID: "s", Prompt: "p"})
		if err == nil {
			t.Fatal("expected nil orchestrator error")
		}
	})
}

func TestEngineRunStream(t *testing.T) {
	engine := New(Options{})
	stream := enginecore.NewSliceStream([]enginecore.Event{
		{Type: enginecore.EventText, Text: "hi"},
		{Type: enginecore.EventFinishStep},
	})
	out, err := engine.RunStream(context.Background(), RunInput{
		SessionID: "test",
		Prompt:    "hello",
		Stream:    stream,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(out.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(out.Messages))
	}
	if len(out.Messages[1].Parts) == 0 {
		t.Fatal("expected assistant parts")
	}
}
