package core

import "testing"

func TestInstructionSourceNilAndEmptyBranches(t *testing.T) {
	t.Cleanup(SetInstructionContextSource(nil))
	t.Cleanup(SetInstructionFileSource(nil))

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

	restoreFiles := SetInstructionFileSource(nil)
	if _, ok := currentInstructionFileSource().ReadFile("AGENTS.md"); ok {
		t.Fatal("nil file source should install empty source")
	}
	restoreFiles()
}

func TestSystemSourceNilSetters(t *testing.T) {
	t.Cleanup(SetSystemPromptSource(nil))
	t.Cleanup(SetSystemEnvironmentSource(nil))

	restorePrompt := SetSystemPromptSource(nil)
	if got := (SystemPromptBuilder{Instructions: []string{"a"}}).Build(); len(got) != 1 || got[0] != "a" {
		t.Fatalf("unexpected prompt builder output: %#v", got)
	}
	restorePrompt()

	restoreEnvironment := SetSystemEnvironmentSource(nil)
	restoreEnvironment()
}
