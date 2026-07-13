package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type testInstructionResolver struct {
	content string
}

func (r testInstructionResolver) Resolve(filePath string) []protocol.InstructionEntry {
	return []protocol.InstructionEntry{
		{
			Path:    filePath,
			Content: r.content,
		},
	}
}

type denyPermission struct{}

func (denyPermission) Ask(req protocol.PermissionRequest) error {
	return errors.New("permission denied")
}

func TestEngineRunStream_WithInstructionResolver(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	engine := New(Options{
		Cwd:         dir,
		Instruction: testInstructionResolver{content: "Instructions from: note.txt\nDo the thing"},
	})
	stream := enginecore.NewSliceStream([]enginecore.Event{
		{
			Type: enginecore.EventTool,
			Tool: &enginecore.ToolCall{
				Name: "read",
				Args: map[string]any{"filePath": "note.txt"},
			},
		},
		{Type: enginecore.EventFinishStep},
	})

	out, err := engine.RunStream(context.Background(), RunInput{
		SessionID: "test",
		Prompt:    "read file",
		Stream:    stream,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	toolState := findToolState(t, out)
	if toolState == nil {
		t.Fatal("expected tool state")
	}
	if toolState.Output == "" {
		t.Fatal("expected tool output")
	}
	if !strings.Contains(toolState.Output, "<system-reminder>") {
		t.Fatalf("expected system reminder, got %q", toolState.Output)
	}
	if !strings.Contains(toolState.Output, "Do the thing") {
		t.Fatalf("expected instruction content, got %q", toolState.Output)
	}
}

func TestEngineRunStream_PermissionDenied(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	engine := New(Options{
		Cwd:        dir,
		Permission: denyPermission{},
	})
	stream := enginecore.NewSliceStream([]enginecore.Event{
		{
			Type: enginecore.EventTool,
			Tool: &enginecore.ToolCall{
				Name: "read",
				Args: map[string]any{"filePath": "note.txt"},
			},
		},
		{Type: enginecore.EventFinishStep},
	})

	out, err := engine.RunStream(context.Background(), RunInput{
		SessionID: "test",
		Prompt:    "read file",
		Stream:    stream,
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	toolState := findToolState(t, out)
	if toolState == nil {
		t.Fatal("expected tool state")
	}
	if toolState.Status != "error" {
		t.Fatalf("expected error status, got %q", toolState.Status)
	}
	if !strings.Contains(toolState.Error, "permission denied") {
		t.Fatalf("expected permission error, got %q", toolState.Error)
	}
}

func findToolState(t *testing.T, out enginecore.Transcript) *enginecore.ToolState {
	t.Helper()
	for _, msg := range out.Messages {
		for _, part := range msg.Parts {
			if part.Type == enginecore.PartTool && part.State != nil {
				return part.State
			}
		}
	}
	return nil
}
