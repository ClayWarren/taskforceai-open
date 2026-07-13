package protocol

import "context"

type PermissionRequest struct {
	Permission string
	Patterns   []string
	Always     []string
	Metadata   map[string]any
}

type PermissionChecker interface {
	Ask(req PermissionRequest) error
}

type TodoStore interface {
	Get() []map[string]any
	Set(items []map[string]any)
}

type InstructionEntry struct {
	Path    string
	Content string
}

type InstructionResolver interface {
	Resolve(filePath string) []InstructionEntry
}

type ToolContext struct {
	Ctx         context.Context //nolint:containedctx // ToolContext is the per-run capability bundle passed to every tool.
	Cwd         string
	ReadFiles   map[string]bool
	Permission  PermissionChecker
	Instruction InstructionResolver
	Todo        TodoStore
	// QuestionAnswer is used by the question tool for headless runs.
	QuestionAnswer    string
	QuestionAnswerSet bool
}
