package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/patch"
)

// acquireCodeSandbox gets (and returns a release func for) the same
// session-scoped code sandbox CreateCodeExecutionTool uses, so file
// operations and code execution within one conversation share a filesystem.
func acquireCodeSandbox(ctx context.Context, pool *SandboxPool) (SandboxSession, func(success bool), error) {
	profile, scopedForReuse := codeExecutionSandboxProfile(ctx)
	sbx, reusable, err := pool.AcquireWithProfile(ctx, SandboxKindCode, profile)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to acquire sandbox: %w", err)
	}
	release := func(success bool) {
		pool.ReleaseWithProfile(ctx, sbx, SandboxKindCode, profile, scopedForReuse && reusable && success)
	}
	return sbx, release, nil
}

func sandboxDisabledResult() ToolResult {
	return ToolResult{
		"success": false,
		"error":   "Sandbox provider credentials are not configured. This tool is disabled.",
	}
}

type sandboxReadArgs struct {
	FilePath string `json:"filePath"`
}

// CreateSandboxReadTool reads a file from the session's cloud sandbox
// filesystem - the Work-mode counterpart to the desktop app's local Code
// tools, since apps/engine never has access to a user's real machine.
func CreateSandboxReadTool(pool *SandboxPool) ITool {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"filePath": map[string]any{
				"type":        "string",
				"description": "The file path to read within the sandbox workspace",
			},
		},
		Required: []string{"filePath"},
	}
	return NewBaseTool(
		"read",
		"Read the contents of a file from the sandboxed cloud workspace.",
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			if pool == nil || !pool.authConfigured {
				return sandboxDisabledResult(), nil
			}
			var input sandboxReadArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, fmt.Errorf("invalid JSON arguments: %w", err)
			}
			if strings.TrimSpace(input.FilePath) == "" {
				return ToolResult{"success": false, "error": "filePath is required"}, nil
			}

			sbx, release, err := acquireCodeSandbox(ctx, pool)
			if err != nil {
				return nil, err
			}
			data, readErr := sbx.ReadFile(ctx, input.FilePath)
			release(readErr == nil)
			if readErr != nil {
				// Surface sandbox I/O failures as tool results so the agent can recover.
				return ToolResult{"success": false, "error": readErr.Error()}, nil //nolint:nilerr
			}
			return ToolResult{"success": true, "content": string(data)}, nil
		},
	)
}

type sandboxWriteArgs struct {
	FilePath string `json:"filePath"`
	Content  string `json:"content"`
}

// CreateSandboxWriteTool creates or overwrites a file in the session's cloud
// sandbox filesystem.
func CreateSandboxWriteTool(pool *SandboxPool) ITool {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"filePath": map[string]any{
				"type":        "string",
				"description": "The file path to write within the sandbox workspace",
			},
			"content": map[string]any{
				"type":        "string",
				"description": "The content to write to the file",
			},
		},
		Required: []string{"filePath", "content"},
	}
	return NewBaseTool(
		"write",
		"Create a new file or overwrite an existing file in the sandboxed cloud workspace.",
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			if pool == nil || !pool.authConfigured {
				return sandboxDisabledResult(), nil
			}
			var input sandboxWriteArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, fmt.Errorf("invalid JSON arguments: %w", err)
			}
			if strings.TrimSpace(input.FilePath) == "" {
				return ToolResult{"success": false, "error": "filePath is required"}, nil
			}

			sbx, release, err := acquireCodeSandbox(ctx, pool)
			if err != nil {
				return nil, err
			}
			writeErr := sbx.WriteFile(ctx, input.FilePath, []byte(input.Content))
			release(writeErr == nil)
			if writeErr != nil {
				// Surface sandbox I/O failures as tool results so the agent can recover.
				return ToolResult{"success": false, "error": writeErr.Error()}, nil //nolint:nilerr
			}
			return ToolResult{"success": true, "filePath": input.FilePath}, nil
		},
	)
}

type sandboxEditArgs struct {
	FilePath  string `json:"filePath"`
	OldString string `json:"oldString"`
	NewString string `json:"newString"`
}

// CreateSandboxEditTool replaces an exact string match in a file already
// present in the session's cloud sandbox filesystem.
func CreateSandboxEditTool(pool *SandboxPool) ITool {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"filePath":  map[string]any{"type": "string", "description": "The file path to edit within the sandbox workspace"},
			"oldString": map[string]any{"type": "string", "description": "The exact string to find and replace"},
			"newString": map[string]any{"type": "string", "description": "The replacement string"},
		},
		Required: []string{"filePath", "oldString", "newString"},
	}
	return NewBaseTool(
		"edit",
		"Edit a file in the sandboxed cloud workspace by replacing an exact string match with new content.",
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			if pool == nil || !pool.authConfigured {
				return sandboxDisabledResult(), nil
			}
			var input sandboxEditArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, fmt.Errorf("invalid JSON arguments: %w", err)
			}
			if strings.TrimSpace(input.FilePath) == "" {
				return ToolResult{"success": false, "error": "filePath is required"}, nil
			}
			if input.OldString == "" {
				return ToolResult{"success": false, "error": "oldString must not be empty"}, nil
			}
			if input.OldString == input.NewString {
				return ToolResult{"success": false, "error": "oldString and newString must be different"}, nil
			}

			sbx, release, err := acquireCodeSandbox(ctx, pool)
			if err != nil {
				return nil, err
			}
			success := false
			defer func() { release(success) }()

			data, readErr := sbx.ReadFile(ctx, input.FilePath)
			if readErr != nil {
				return ToolResult{"success": false, "error": readErr.Error()}, nil
			}
			if !strings.Contains(string(data), input.OldString) {
				success = true // sandbox is intact, just no match - not a session-breaking failure
				return ToolResult{"success": false, "error": "oldString was not found in " + input.FilePath}, nil
			}
			updated := strings.ReplaceAll(string(data), input.OldString, input.NewString)
			if writeErr := sbx.WriteFile(ctx, input.FilePath, []byte(updated)); writeErr != nil {
				return ToolResult{"success": false, "error": writeErr.Error()}, nil
			}
			success = true
			return ToolResult{"success": true, "filePath": input.FilePath}, nil
		},
	)
}

type sandboxApplyPatchArgs struct {
	Patch string `json:"patch"`
}

// CreateSandboxApplyPatchTool applies a multi-file patch envelope (see
// pkg/patch) against the session's cloud sandbox filesystem.
func CreateSandboxApplyPatchTool(pool *SandboxPool) ITool {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"patch": map[string]any{
				"type":        "string",
				"description": "The full patch text, wrapped in *** Begin Patch / *** End Patch.",
			},
		},
		Required: []string{"patch"},
	}
	return NewBaseTool(
		"apply_patch",
		"Apply a multi-file patch (add, delete, update, or rename files) in the sandboxed cloud workspace in a single call using the Begin/End Patch envelope format.",
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			if pool == nil || !pool.authConfigured {
				return sandboxDisabledResult(), nil
			}
			var input sandboxApplyPatchArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, fmt.Errorf("invalid JSON arguments: %w", err)
			}
			if strings.TrimSpace(input.Patch) == "" {
				return ToolResult{"success": false, "error": "patch is required"}, nil
			}

			ops, parseErr := patch.Parse(input.Patch)
			if parseErr != nil {
				return ToolResult{"success": false, "error": parseErr.Error()}, nil
			}
			if len(ops) == 0 {
				return ToolResult{"success": false, "error": "patch contains no file operations"}, nil
			}

			sbx, release, err := acquireCodeSandbox(ctx, pool)
			if err != nil {
				return nil, err
			}
			success := false
			defer func() { release(success) }()

			var applied []string
			for _, op := range ops {
				label, opErr := applySandboxPatchOp(ctx, sbx, op)
				if opErr != nil {
					if len(applied) == 0 {
						return ToolResult{"success": false, "error": fmt.Sprintf("unable to apply patch at %s: %s", label, opErr.Error())}, nil
					}
					return ToolResult{
						"success": false,
						"error": fmt.Sprintf(
							"patch partially applied before failing at %s: %s. Applied: %s",
							label, opErr.Error(), strings.Join(applied, ", "),
						),
					}, nil
				}
				applied = append(applied, label)
			}

			success = true
			return ToolResult{"success": true, "changedFiles": applied}, nil
		},
	)
}

func applySandboxPatchOp(ctx context.Context, sbx SandboxSession, op patch.Op) (string, error) {
	switch op.Kind {
	case patch.Add:
		content := patch.JoinLines(op.AddLines)
		if err := sbx.WriteFile(ctx, op.Path, []byte(content)); err != nil {
			return op.Path, err
		}
		return op.Path, nil
	case patch.Delete:
		if err := sbx.DeleteFile(ctx, op.Path); err != nil {
			return op.Path, err
		}
		return op.Path, nil
	case patch.Update:
		data, err := sbx.ReadFile(ctx, op.Path)
		if err != nil {
			return op.Path, fmt.Errorf("file not found: %s", op.Path)
		}
		updatedLines, err := patch.ApplyHunks(patch.SplitLines(string(data)), op.Hunks)
		if err != nil {
			return op.Path, err
		}
		updated := patch.JoinLinesPreservingFinalNewline(updatedLines, string(data))

		destPath := op.Path
		if op.MoveTo != "" {
			destPath = op.MoveTo
		}
		if err := sbx.WriteFile(ctx, destPath, []byte(updated)); err != nil {
			return destPath, err
		}
		if op.MoveTo != "" {
			if err := sbx.DeleteFile(ctx, op.Path); err != nil {
				return destPath, err
			}
			return op.Path + " -> " + op.MoveTo, nil
		}
		return op.Path, nil
	default:
		return op.Path, fmt.Errorf("unknown patch operation")
	}
}
