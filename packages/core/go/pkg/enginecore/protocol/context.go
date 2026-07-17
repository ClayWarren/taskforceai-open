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

// PlanStore tracks whether the session is in plan mode (a read-only
// phase where mutating tools are denied until the plan is approved).
// Like TodoStore, it's a reference-typed field on ToolContext so mutations
// survive the context being passed by value.
type PlanStore interface {
	IsActive() bool
	Enter()
	Exit()
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
	Plan        PlanStore
	// QuestionAnswer is used by the question tool for headless runs.
	QuestionAnswer    string
	QuestionAnswerSet bool
}
