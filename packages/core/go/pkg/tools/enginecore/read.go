package tools

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

const maxReadLineLimit = 2000
const maxReadOutputBytes = 50 * 1024
const maxReadFileBytes = maxReadOutputBytes

func toolRead(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	parsed, missing := parseReadArgs(args)
	if len(missing) > 0 {
		return invalidArgs("read", args, missing...)
	}
	fp := parsed.filePath
	full := filepath.Join(ctx.Cwd, fp)
	displayPath := strings.TrimRight(fp, "/")
	if displayPath == "" {
		displayPath = fp
	}
	if err := assertExternalDirectory(ctx, full, &externalDirectoryOptions{Kind: kindFile}); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	data, fileTruncated, err := readToolFile(full) // #nosec G304 -- path validated by external directory guard
	if err != nil {
		return fileNotFoundResult(state, full, displayPath)
	}

	ext := filepath.Ext(full)
	mimeType := mime.TypeByExtension(strings.ToLower(ext))
	isImage := strings.HasPrefix(mimeType, "image/") &&
		mimeType != "image/svg+xml" &&
		mimeType != "image/vnd.fastbidsheet"
	isPDF := ext == ".pdf"
	if isImage || isPDF {
		if fileTruncated {
			state.Status = "error"
			state.Error = fmt.Sprintf("Error: File exceeds read limit of %d bytes: <cwd>/%s", maxReadFileBytes, fp)
			return state
		}
		state = mediaReadResult(ctx, state, fp, full, mimeType, data, isPDF)
		markRead(ctx, fp)
		return state
	}
	if isBinaryFile(full, data) {
		state.Status = "error"
		state.Error = "Error: Cannot read binary file: <cwd>/" + fp
		return state
	}

	limit := parsed.limit
	offset := parsed.offset
	if offset < 0 {
		state.Status = "error"
		state.Error = "Error: offset must be >= 0"
		state.Input = args
		return state
	}
	if limit <= 0 {
		state.Status = "error"
		state.Error = "Error: limit must be > 0"
		state.Input = args
		return state
	}
	if limit > maxReadLineLimit {
		limit = maxReadLineLimit
	}

	output, previewLines, truncated := formatTextRead(data, offset, limit, fileTruncated)
	state.Output = output
	state.Title = fp
	state.TitleSet = true
	if len(previewLines) > 20 {
		previewLines = previewLines[:20]
	}
	metadata := map[string]any{
		"preview":   strings.Join(previewLines, "\n"),
		"truncated": truncated,
	}
	loaded, reminders := readInstructionDetails(ctx, full)
	if len(loaded) > 0 {
		metadata["loaded"] = loaded
	}
	if len(reminders) > 0 {
		state.Output = state.Output + "\n\n<system-reminder>\n" + strings.Join(reminders, "\n\n") + "\n</system-reminder>"
	}
	state.Metadata = metadata
	markRead(ctx, fp)
	return state
}

func readToolFile(path string) ([]byte, bool, error) {
	return util.CurrentFileSystem().ReadFileLimit(path, maxReadFileBytes)
}

func markRead(ctx protocol.ToolContext, filePath string) {
	if ctx.ReadFiles == nil {
		return
	}
	ctx.ReadFiles[filePath] = true
}

func fileNotFoundResult(state ToolResult, full, displayPath string) ToolResult {
	suggestions := similarFileSuggestions(full)
	state.Status = "error"
	state.Error = "Error: File not found: <cwd>/" + displayPath
	if len(suggestions) > 0 {
		state.Error += "\n\nDid you mean one of these?\n" + strings.Join(suggestions, "\n")
	}
	return state
}

func similarFileSuggestions(full string) []string {
	entries, err := util.CurrentFileSystem().ReadDir(filepath.Dir(full))
	if err != nil {
		return nil
	}
	base := filepath.Base(full)
	lowerBase := strings.ToLower(base)
	suggestions := []string{}
	for _, entry := range entries {
		name := entry.Name()
		lowerName := strings.ToLower(name)
		if strings.Contains(lowerName, lowerBase) || strings.Contains(lowerBase, lowerName) {
			suggestions = append(suggestions, filepath.Join(filepath.Dir(full), name))
			if len(suggestions) >= 3 {
				break
			}
		}
	}
	return suggestions
}

func mediaReadResult(ctx protocol.ToolContext, state ToolResult, fp, full, mimeType string, data []byte, isPDF bool) ToolResult {
	msg := "Image read successfully"
	if isPDF {
		msg = "PDF read successfully"
	}
	metadata := map[string]any{
		"preview":   msg,
		"truncated": false,
	}
	loaded, _ := readInstructionDetails(ctx, full)
	if len(loaded) > 0 {
		metadata["loaded"] = loaded
	}

	state.Output = msg
	state.Title = fp
	state.TitleSet = true
	state.Metadata = metadata
	state.Attachments = []map[string]any{{
		"type": "file",
		"mime": mimeType,
		"url":  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data),
	}}
	return state
}

func formatTextRead(data []byte, offset, limit int, fileTruncated bool) (string, []string, bool) {
	const maxLineLen = 2000
	const maxBytes = maxReadOutputBytes

	window := readTextWindow(data, offset, limit, maxLineLen, maxBytes)
	lastReadLine := offset + len(window.lines)
	hasMoreLines := window.totalLines > lastReadLine
	truncatedByBytes := window.truncatedByBytes || fileTruncated
	truncated := hasMoreLines || truncatedByBytes

	var b strings.Builder
	b.WriteString("<file>\n")
	for i, line := range window.lines {
		if i > 0 {
			b.WriteByte('\n')
		}
		writeReadLinePrefix(&b, i+offset+1)
		b.WriteString(line)
	}
	writeReadFooter(&b, window.totalLines, lastReadLine, truncatedByBytes, hasMoreLines, maxBytes)
	b.WriteString("\n</file>")
	return b.String(), window.lines, truncated
}

type textReadWindow struct {
	lines            []string
	totalLines       int
	truncatedByBytes bool
}

func readTextWindow(data []byte, offset, limit, maxLineLen, maxBytes int) textReadWindow {
	data = bytes.TrimPrefix(data, []byte("\uFEFF"))
	if len(data) == 0 {
		return textReadWindow{totalLines: 1}
	}

	out := textReadWindow{
		lines: make([]string, 0, limit),
	}
	bytesUsed := 0
	lineNumber := 0
	for start := 0; ; {
		lineNumber++
		next := bytes.IndexByte(data[start:], '\n')
		end := len(data)
		if next >= 0 {
			end = start + next
		}

		if lineNumber > offset && len(out.lines) < limit && !out.truncatedByBytes {
			line := string(data[start:end])
			if len(line) > maxLineLen && utf16Len(line) > maxLineLen {
				line = truncateUTF16(line, maxLineLen) + "..."
			}
			size := len(line)
			if len(out.lines) > 0 {
				size++
			}
			if bytesUsed+size > maxBytes {
				out.truncatedByBytes = true
			} else {
				out.lines = append(out.lines, line)
				bytesUsed += size
			}
		}

		if next < 0 {
			out.totalLines = lineNumber
			return out
		}
		start = end + 1
		if start == len(data) || len(out.lines) >= limit || out.truncatedByBytes {
			out.totalLines = lineNumber + 1
			return out
		}
	}
}

func writeReadLinePrefix(b *strings.Builder, lineNumber int) {
	line := strconv.Itoa(lineNumber)
	for i := len(line); i < 5; i++ {
		b.WriteByte('0')
	}
	b.WriteString(line)
	b.WriteString("| ")
}

func writeReadFooter(b *strings.Builder, totalLines, lastReadLine int, truncatedByBytes, hasMoreLines bool, maxBytes int) {
	switch {
	case truncatedByBytes:
		fmt.Fprintf(b, "\n\n(Output truncated at %d bytes. Use 'offset' parameter to read beyond line %d)", maxBytes, lastReadLine)
	case hasMoreLines:
		fmt.Fprintf(b, "\n\n(File has more lines. Use 'offset' parameter to read beyond line %d)", lastReadLine)
	default:
		fmt.Fprintf(b, "\n\n(End of file - total %d lines)", totalLines)
	}
}

func readInstructionDetails(ctx protocol.ToolContext, full string) ([]string, []string) {
	if ctx.Instruction == nil {
		return nil, nil
	}
	extra := ctx.Instruction.Resolve(filepath.ToSlash(full))
	loaded := []string{}
	reminders := make([]string, 0, len(extra))
	for _, entry := range extra {
		if entry.Path != "" {
			loaded = append(loaded, entry.Path)
		}
		if entry.Content != "" {
			reminders = append(reminders, entry.Content)
		}
	}
	return loaded, reminders
}

func truncateUTF16(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	count := 0
	end := 0
	for i, r := range value {
		inc := 1
		if r > 0xFFFF {
			inc = 2
		}
		if count+inc > limit {
			break
		}
		count += inc
		end = i + utf8.RuneLen(r)
	}
	return value[:end]
}

func utf16Len(value string) int {
	count := 0
	for _, r := range value {
		if r > 0xFFFF {
			count += 2
		} else {
			count++
		}
	}
	return count
}

func toInt(v any) (int, bool) {
	switch t := v.(type) {
	case int:
		return t, true
	case int64:
		return int(t), true
	case float64:
		return int(t), true
	case string:
		n, err := strconv.Atoi(t)
		if err == nil {
			return n, true
		}
	}
	return 0, false
}

func isBinaryFile(path string, data []byte) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war", ".7z",
		".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
		".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo":
		return true
	}
	if len(data) == 0 {
		return false
	}
	if !utf8.Valid(data) {
		return true
	}
	nonPrintable := 0
	for _, b := range data {
		if b == 0 {
			return true
		}
		if b < 9 || (b > 13 && b < 32) {
			nonPrintable++
		}
	}
	return float64(nonPrintable)/float64(len(data)) > 0.3
}
