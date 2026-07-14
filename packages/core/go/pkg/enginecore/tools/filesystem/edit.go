package filesystem

import (
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

var makeEditDirectory = func(path string, mode fs.FileMode) error {
	return util.CurrentFileSystem().MkdirAll(path, mode)
}
var writeEditFile = func(path string, data []byte, mode fs.FileMode) error {
	return util.CurrentFileSystem().WriteFile(path, data, mode)
}

func ExecuteEdit(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	parsed, missing := parseEditArgs(args)
	if len(missing) > 0 {
		return toolutil.InvalidArgs("edit", args, missing...)
	}
	if strings.HasSuffix(parsed.filePath, "/") {
		state.Status = "error"
		state.Error = "Error: Path is a directory, not a file: <cwd>/" + parsed.filePath
		state.Input = args
		return state
	}

	if parsed.oldString == parsed.newString {
		state.Status = "error"
		state.Error = "Error: oldString and newString must be different"
		return state
	}
	full := filepath.Join(ctx.Cwd, parsed.filePath)
	if err := filepolicy.Assert(ctx, full, &filepolicy.Options{Kind: filepolicy.File}); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	data, err := util.CurrentFileSystem().ReadFile(full)
	if err != nil {
		if parsed.oldString == "" && errors.Is(err, fs.ErrNotExist) {
			return createEditFile(state, full, parsed)
		}
		state.Status = "error"
		state.Error = "Error: File <cwd>/" + parsed.filePath + " not found"
		return state
	}
	if !ctx.ReadFiles[parsed.filePath] {
		pathLabel := "<cwd>/" + filepath.ToSlash(parsed.filePath)
		clean := filepath.Clean(full)
		prefix := ctx.Cwd + string(filepath.Separator)
		if clean != ctx.Cwd && !strings.HasPrefix(clean, prefix) {
			pathLabel = full
		}
		state.Status = "error"
		state.Error = "Error: You must read file " + pathLabel + " before overwriting it. Use the Read tool first"
		return state
	}
	if parsed.oldString == "" {
		state.Status = "error"
		state.Error = "Error: oldString must not be empty when editing an existing file"
		return state
	}
	if !strings.Contains(string(data), parsed.oldString) {
		state.Status = "error"
		state.Error = "Error: oldString was not found in <cwd>/" + parsed.filePath
		return state
	}
	// ReplaceAll mirrors the TS tool: all matches are updated, not just the first.
	updated := strings.ReplaceAll(string(data), parsed.oldString, parsed.newString)
	if err := writeEditFile(full, []byte(updated), 0o600); err != nil { // #nosec G703 -- full is resolved by parseEditArgs and guarded by the prior read requirement.
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	diff, filediff := buildUnifiedDiff(full, string(data), updated)
	state.Output = "Edit applied successfully."
	state.Title = parsed.filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"diagnostics": map[string]any{},
		"diff":        diff,
		"filediff":    filediff,
		"truncated":   false,
	}
	return state
}

func createEditFile(state protocol.ToolResult, full string, parsed editArgs) protocol.ToolResult {
	if err := makeEditDirectory(filepath.Dir(full), 0o750); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	if err := writeEditFile(full, []byte(parsed.newString), 0o600); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	diff, filediff := buildUnifiedDiff(full, "", parsed.newString)
	state.Output = "Edit applied successfully."
	state.Title = parsed.filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"diagnostics": map[string]any{},
		"diff":        diff,
		"filediff":    filediff,
		"truncated":   false,
	}
	return state
}

type fileDiff struct {
	File      string `json:"file"`
	Before    string `json:"before"`
	After     string `json:"after"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

func buildUnifiedDiff(path, before, after string) (string, fileDiff) {
	oldLines, oldHasNewline := normalizedDiffLines(before)
	newLines, newHasNewline := normalizedDiffLines(after)
	start, endOld, endNew := changedLineRange(oldLines, newLines)
	oldChunk := diffChunk(oldLines, start, endOld)
	newChunk := diffChunk(newLines, start, endNew)
	diff := renderUnifiedDiff(path, start, oldLines, newLines, oldChunk, newChunk, oldHasNewline, newHasNewline)
	fd := fileDiff{File: path, Before: before, After: after, Additions: len(newChunk), Deletions: len(oldChunk)}
	return diff, fd
}

func normalizedDiffLines(content string) ([]string, bool) {
	if content == "" {
		return []string{}, false
	}
	lines := strings.Split(content, "\n")
	hasNewline := strings.HasSuffix(content, "\n")
	if hasNewline && len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines, hasNewline
}

func changedLineRange(oldLines, newLines []string) (int, int, int) {
	start := 0
	for start < len(oldLines) && start < len(newLines) && oldLines[start] == newLines[start] {
		start++
	}
	endOld, endNew := len(oldLines)-1, len(newLines)-1
	for endOld >= start && endNew >= start && oldLines[endOld] == newLines[endNew] {
		endOld--
		endNew--
	}
	return start, endOld, endNew
}

func diffChunk(lines []string, start, end int) []string {
	if start > end {
		return []string{}
	}
	return lines[start : end+1]
}

func renderUnifiedDiff(path string, start int, oldLines, newLines, oldChunk, newChunk []string, oldHasNewline, newHasNewline bool) string {
	oldStart := start + 1
	if len(oldChunk) == 0 {
		oldStart = 0
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Index: %s\n", path)
	b.WriteString("===================================================================\n")
	fmt.Fprintf(&b, "--- %s\n", path)
	fmt.Fprintf(&b, "+++ %s\n", path)
	fmt.Fprintf(&b, "@@ -%d,%d +%d,%d @@\n", oldStart, len(oldChunk), start+1, len(newChunk))
	for _, line := range oldChunk {
		b.WriteString("-" + line + "\n")
	}
	if !oldHasNewline && len(oldLines) > 0 {
		b.WriteString("\\ No newline at end of file\n")
	}
	for _, line := range newChunk {
		b.WriteString("+" + line + "\n")
	}
	if !newHasNewline && len(newLines) > 0 {
		b.WriteString("\\ No newline at end of file\n")
	}

	return b.String()
}
