package filesystem

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/patch"
)

// ExecuteApplyPatch applies a multi-file patch envelope (the same grammar
// opencode and codex converge on: *** Begin Patch / Add File / Delete File /
// Update File [+ Move to] / @@ hunks / *** End Patch) against the local
// filesystem. Files are changed sequentially and are not rolled back on a
// later failure - this matches both upstream implementations, which report
// how far the patch got rather than guaranteeing atomicity across files.
func ExecuteApplyPatch(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	parsed, missing := parseApplyPatchArgs(args)
	if len(missing) > 0 {
		return toolutil.InvalidArgs("apply_patch", args, missing...)
	}

	ops, err := patch.Parse(parsed.patch)
	if err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	if len(ops) == 0 {
		state.Status = "error"
		state.Error = "Error: patch contains no file operations"
		return state
	}

	var applied []string
	var diffs []fileDiff
	for _, op := range ops {
		label, diff, err := applyPatchOp(ctx, op)
		if err != nil {
			state.Status = "error"
			if len(applied) == 0 {
				state.Error = fmt.Sprintf("Error: Unable to apply patch at %s: %s", label, err.Error())
			} else {
				state.Error = fmt.Sprintf(
					"Error: Patch partially applied before failing at %s: %s. Applied: %s",
					label, err.Error(), strings.Join(applied, ", "),
				)
			}
			return state
		}
		applied = append(applied, label)
		if diff != nil {
			diffs = append(diffs, *diff)
		}
	}

	var b strings.Builder
	b.WriteString("Patch applied successfully.\nChanged files:\n")
	for _, path := range applied {
		b.WriteString("- " + path + "\n")
	}
	state.Output = strings.TrimRight(b.String(), "\n")
	state.Metadata = map[string]any{
		"diagnostics": map[string]any{},
		"filediffs":   diffs,
		"truncated":   false,
	}
	return state
}

func applyPatchOp(ctx protocol.ToolContext, op patch.Op) (string, *fileDiff, error) {
	switch op.Kind {
	case patch.Add:
		return applyAddOp(ctx, op)
	case patch.Delete:
		return applyDeleteOp(ctx, op)
	case patch.Update:
		return applyUpdateOp(ctx, op)
	default:
		return op.Path, nil, fmt.Errorf("unknown patch operation")
	}
}

func applyAddOp(ctx protocol.ToolContext, op patch.Op) (string, *fileDiff, error) {
	full := filepath.Join(ctx.Cwd, op.Path)
	if err := filepolicy.Assert(ctx, full, &filepolicy.Options{Kind: filepolicy.File}); err != nil {
		return op.Path, nil, err
	}
	content := patch.JoinLines(op.AddLines)
	if err := makeEditDirectory(filepath.Dir(full), 0o750); err != nil {
		return op.Path, nil, err
	}
	if err := writeEditFile(full, []byte(content), 0o600); err != nil {
		return op.Path, nil, err
	}
	_, diff := buildUnifiedDiff(full, "", content)
	return op.Path, &diff, nil
}

func applyDeleteOp(ctx protocol.ToolContext, op patch.Op) (string, *fileDiff, error) {
	full := filepath.Join(ctx.Cwd, op.Path)
	if err := filepolicy.Assert(ctx, full, &filepolicy.Options{Kind: filepolicy.File}); err != nil {
		return op.Path, nil, err
	}
	before, err := util.CurrentFileSystem().ReadFile(full)
	if err != nil {
		return op.Path, nil, fmt.Errorf("file not found: %s", op.Path)
	}
	if err := util.CurrentFileSystem().Remove(full); err != nil {
		return op.Path, nil, err
	}
	_, diff := buildUnifiedDiff(full, string(before), "")
	return op.Path, &diff, nil
}

func applyUpdateOp(ctx protocol.ToolContext, op patch.Op) (string, *fileDiff, error) {
	full := filepath.Join(ctx.Cwd, op.Path)
	if err := filepolicy.Assert(ctx, full, &filepolicy.Options{Kind: filepolicy.File}); err != nil {
		return op.Path, nil, err
	}
	if !ctx.ReadFiles[op.Path] {
		return op.Path, nil, fmt.Errorf("you must read file <cwd>/%s before patching it. Use the Read tool first", filepath.ToSlash(op.Path))
	}
	data, err := util.CurrentFileSystem().ReadFile(full)
	if err != nil {
		return op.Path, nil, fmt.Errorf("file not found: %s", op.Path)
	}
	before := string(data)

	updatedLines, err := patch.ApplyHunks(patch.SplitLines(before), op.Hunks)
	if err != nil {
		return op.Path, nil, err
	}
	updated := patch.JoinLinesPreservingFinalNewline(updatedLines, before)

	destPath := op.Path
	destFull := full
	if op.MoveTo != "" {
		destPath = op.MoveTo
		destFull = filepath.Join(ctx.Cwd, op.MoveTo)
		if err := filepolicy.Assert(ctx, destFull, &filepolicy.Options{Kind: filepolicy.File}); err != nil {
			return op.Path, nil, err
		}
	}

	if err := makeEditDirectory(filepath.Dir(destFull), 0o750); err != nil {
		return destPath, nil, err
	}
	if err := writeEditFile(destFull, []byte(updated), 0o600); err != nil {
		return destPath, nil, err
	}
	if op.MoveTo != "" {
		if err := util.CurrentFileSystem().Remove(full); err != nil {
			return destPath, nil, err
		}
	}

	_, diff := buildUnifiedDiff(destFull, before, updated)
	label := op.Path
	if op.MoveTo != "" {
		label = op.Path + " -> " + op.MoveTo
	}
	return label, &diff, nil
}
