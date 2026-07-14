// Package filepolicy owns path-boundary policy shared by filesystem and artifact tools.
package filepolicy

import (
	"errors"
	"path/filepath"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type Kind string

const (
	File      Kind = "file"
	Directory Kind = "directory"
)

type Options struct {
	Bypass bool
	Kind   Kind
}

var ErrPermissionCheckerRequired = errors.New("external directory access denied: permission checker is required")

func PrepareFile(ctx protocol.ToolContext, filePath string, state *protocol.ToolResult) (string, bool) {
	full, err := FilePath(ctx, filePath, File)
	if err != nil {
		toolutil.MarkError(state, "Error: "+err.Error())
		return "", false
	}
	return full, true
}

func FilePath(ctx protocol.ToolContext, filePath string, kind Kind) (string, error) {
	full := filepath.Join(ctx.Cwd, filePath)
	if err := Assert(ctx, full, &Options{Kind: kind}); err != nil {
		return "", err
	}
	return full, nil
}

func BaseName(filePath string) string {
	return filepath.Base(filePath)
}

func Assert(ctx protocol.ToolContext, target string, options *Options) error {
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

	kind := File
	if options != nil && options.Kind != "" {
		kind = options.Kind
	}
	parentDir := target
	if kind != Directory {
		parentDir = filepath.Dir(target)
	}
	glob := filepath.Join(parentDir, "*")
	if ctx.Permission == nil {
		return ErrPermissionCheckerRequired
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
