package tools

import (
	"errors"
	"path/filepath"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type externalDirectoryKind string

const (
	kindFile      externalDirectoryKind = "file"
	kindDirectory externalDirectoryKind = "directory"
)

type externalDirectoryOptions struct {
	Bypass bool
	Kind   externalDirectoryKind
}

var errExternalDirectoryPermissionCheckerRequired = errors.New("external directory access denied: permission checker is required")

func prepareExternalFile(ctx protocol.ToolContext, filePath string, state *ToolResult) (string, bool) {
	full, err := externalFilePath(ctx, filePath, kindFile)
	if err != nil {
		markToolError(state, "Error: "+err.Error())
		return "", false
	}
	return full, true
}

func externalFilePath(ctx protocol.ToolContext, filePath string, kind externalDirectoryKind) (string, error) {
	full := filepath.Join(ctx.Cwd, filePath)
	if err := assertExternalDirectory(ctx, full, &externalDirectoryOptions{Kind: kind}); err != nil {
		return "", err
	}
	return full, nil
}

func externalFileBaseName(filePath string) string {
	return filepath.Base(filePath)
}

func markToolError(state *ToolResult, message string) {
	state.Status = "error"
	state.Error = message
}

func assertExternalDirectory(ctx protocol.ToolContext, target string, options *externalDirectoryOptions) error {
	if target == "" {
		return nil
	}
	root := ctx.Cwd
	if root == "" {
		root = util.Worktree()
	}
	if util.ContainsPath(root, target) {
		return nil
	}

	kind := kindFile
	if options != nil && options.Kind != "" {
		kind = options.Kind
	}
	parentDir := target
	if kind != kindDirectory {
		parentDir = filepath.Dir(target)
	}
	glob := filepath.Join(parentDir, "*")
	if ctx.Permission == nil {
		return errExternalDirectoryPermissionCheckerRequired
	}
	return ctx.Permission.Ask(protocol.PermissionRequest{
		Permission: "external_directory",
		Patterns:   []string{glob},
		Always:     []string{glob},
		Metadata: map[string]any{
			"filePath":  target,
			"filepath":  target,
			"parentDir": parentDir,
		},
	})
}
