package filesystem

import (
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

var makeWriteDirectory = func(path string, mode fs.FileMode) error {
	return util.CurrentFileSystem().MkdirAll(path, mode)
}
var writeToolFile = func(path string, data []byte, mode fs.FileMode) error {
	return util.CurrentFileSystem().WriteFile(path, data, mode)
}
var renameWriteFile = func(oldPath, newPath string) error {
	return util.CurrentFileSystem().Rename(oldPath, newPath)
}
var removeWriteTemp = func(path string) error { return util.CurrentFileSystem().Remove(path) }

func ExecuteWrite(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	parsed, missing := parseWriteArgs(args)
	if len(missing) > 0 {
		return toolutil.InvalidArgs("write", args, missing...)
	}
	if strings.HasSuffix(parsed.filePath, "/") {
		state.Status = "error"
		state.Error = "Error: path is a directory, not a file: <cwd>/" + parsed.filePath
		state.Input = args
		return state
	}
	full := filepath.Join(ctx.Cwd, parsed.filePath)

	_, err := util.CurrentFileSystem().Stat(full)
	exists := err == nil

	if err := filepolicy.Assert(ctx, full, &filepolicy.Options{Kind: filepolicy.File}); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	if exists && !ctx.ReadFiles[parsed.filePath] {
		pathLabel := "<cwd>/" + filepath.ToSlash(parsed.filePath)
		clean := filepath.Clean(full)
		prefix := ctx.Cwd + string(filepath.Separator)
		if clean != ctx.Cwd && !strings.HasPrefix(clean, prefix) {
			pathLabel = full
		}
		state.Status = "error"
		state.Error = "Error: You must read file " + pathLabel + " before overwriting it. Use the Read tool first"
		state.Input = args
		return state
	}
	if err := makeWriteDirectory(filepath.Dir(full), 0o750); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	tempPath := full + ".tmp"
	if err := writeToolFile(tempPath, []byte(parsed.content), 0o600); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	if err := renameWriteFile(tempPath, full); err != nil {
		_ = removeWriteTemp(tempPath)
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}

	state.Output = "Wrote file successfully."
	state.Title = parsed.filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"diagnostics": map[string]any{},
		"filepath":    "<cwd>/" + filepath.ToSlash(parsed.filePath),
		"exists":      exists,
		"truncated":   false,
	}
	return state
}
