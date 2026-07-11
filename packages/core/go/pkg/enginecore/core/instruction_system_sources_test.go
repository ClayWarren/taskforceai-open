package core

import "testing"

func TestInstructionSourceNilAndEmptyBranches(t *testing.T) {
	t.Cleanup(func() {
		instructionContextSourceMu.Lock()
		instructionContextSource = emptyInstructionContextSource{}
		instructionContextSourceMu.Unlock()
		instructionFileSourceMu.Lock()
		instructionFileSource = emptyInstructionFileSource{}
		instructionFileSourceMu.Unlock()
	})

	var fn InstructionContextSourceFunc
	if got := fn.InstructionContext(); got != (InstructionContext{}) {
		t.Fatalf("nil func should return empty context, got %#v", got)
	}

	emptyFiles := emptyInstructionFileSource{}
	if paths := emptyFiles.ResolvePaths("file.go", nil, InstructionFileRequest{}); paths != nil {
		t.Fatalf("expected nil resolved paths, got %#v", paths)
	}
	if text, ok := emptyFiles.ReadFile("AGENTS.md"); ok || text != "" {
		t.Fatalf("expected empty file read, got %q %v", text, ok)
	}

	restoreContext := SetInstructionContextSource(nil)
	if got := instructionContext(); got != (InstructionContext{}) {
		t.Fatalf("nil context source should install empty context, got %#v", got)
	}
	restoreContext()

	instructionContextSourceMu.Lock()
	instructionContextSource = nil
	instructionContextSourceMu.Unlock()
	if got := instructionContext(); got != (InstructionContext{}) {
		t.Fatalf("nil stored context source should return empty context, got %#v", got)
	}

	restoreFiles := SetInstructionFileSource(nil)
	if _, ok := currentInstructionFileSource().ReadFile("AGENTS.md"); ok {
		t.Fatal("nil file source should install empty source")
	}
	restoreFiles()

	instructionFileSourceMu.Lock()
	instructionFileSource = nil
	instructionFileSourceMu.Unlock()
	if _, ok := currentInstructionFileSource().ReadFile("AGENTS.md"); ok {
		t.Fatal("nil stored file source should resolve to empty source")
	}
}

func TestSystemSourceNilSetters(t *testing.T) {
	t.Cleanup(func() {
		systemPromptSourceMu.Lock()
		systemPromptSource = emptySystemPromptSource{}
		systemPromptSourceMu.Unlock()
		systemEnvironmentSourceMu.Lock()
		systemEnvironmentSource = emptySystemEnvironmentSource{}
		systemEnvironmentSourceMu.Unlock()
	})

	restorePrompt := SetSystemPromptSource(nil)
	if got := (SystemPromptBuilder{Instructions: []string{"a"}}).Build(); len(got) != 1 || got[0] != "a" {
		t.Fatalf("unexpected prompt builder output: %#v", got)
	}
	restorePrompt()

	restoreEnvironment := SetSystemEnvironmentSource(nil)
	restoreEnvironment()
}
