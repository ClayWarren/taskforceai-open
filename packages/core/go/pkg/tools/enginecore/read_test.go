package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubInstructionResolver struct {
	entries map[string][]protocol.InstructionEntry
}

func (s stubInstructionResolver) Resolve(filePath string) []protocol.InstructionEntry {
	if values, ok := s.entries[filePath]; ok {
		return values
	}
	return nil
}

func TestToolRead(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-read-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	testFile := filepath.Join(tmpDir, "hello.txt")
	err = os.WriteFile(testFile, []byte("line 1\nline 2\nline 3"), 0600)
	require.NoError(t, err)

	ctx := protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       tmpDir,
		ReadFiles: make(map[string]bool),
	}

	t.Run("read success", func(t *testing.T) {
		args := map[string]any{"filePath": "hello.txt"}
		res := toolRead(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "line 1")
		assert.Contains(t, res.Output, "line 2")
		assert.Contains(t, res.Output, "line 3")
		assert.True(t, ctx.ReadFiles["hello.txt"])
	})

	t.Run("execute read with nil read-files map", func(t *testing.T) {
		zeroCtx := protocol.ToolContext{
			Ctx: context.Background(),
			Cwd: tmpDir,
		}
		res := ExecuteTool(zeroCtx, "read", map[string]any{"filePath": "hello.txt"})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "line 1")
	})

	t.Run("direct read with nil read-files map does not panic", func(t *testing.T) {
		zeroCtx := protocol.ToolContext{
			Ctx: context.Background(),
			Cwd: tmpDir,
		}
		require.NotPanics(t, func() {
			res := toolRead(zeroCtx, map[string]any{"filePath": "hello.txt"})
			assert.Equal(t, "completed", res.Status)
			assert.Contains(t, res.Output, "line 1")
		})
	})

	t.Run("read missing file", func(t *testing.T) {
		args := map[string]any{"filePath": "missing.txt"}
		res := toolRead(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "File not found")
	})

	t.Run("read missing file suggestions include max three matches", func(t *testing.T) {
		for _, name := range []string{"ahell.txt", "bhell.txt", "chell.txt", "dhell.txt"} {
			err = os.WriteFile(filepath.Join(tmpDir, name), []byte(name), 0600)
			require.NoError(t, err)
		}

		res := toolRead(ctx, map[string]any{"filePath": "hell"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Did you mean one of these?")
		assert.Contains(t, res.Error, filepath.Join(tmpDir, "ahell.txt"))
		assert.Contains(t, res.Error, filepath.Join(tmpDir, "bhell.txt"))
		assert.Contains(t, res.Error, filepath.Join(tmpDir, "chell.txt"))
		assert.NotContains(t, res.Error, filepath.Join(tmpDir, "dhell.txt"))
	})

	t.Run("read with offset and limit", func(t *testing.T) {
		args := map[string]any{
			"filePath": "hello.txt",
			"offset":   1,
			"limit":    1,
		}
		res := toolRead(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "line 2")
		assert.NotContains(t, res.Output, "line 1")
		assert.NotContains(t, res.Output, "line 3")
		assert.Contains(t, res.Output, "Use 'offset' parameter to read beyond line 2")
		assert.Equal(t, true, res.Metadata["truncated"])
	})

	t.Run("read with negative offset fails", func(t *testing.T) {
		args := map[string]any{
			"filePath": "hello.txt",
			"offset":   -1,
		}
		res := toolRead(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "offset must be >= 0")
		assert.Equal(t, args, res.Input)
	})

	t.Run("read with non-positive limit fails", func(t *testing.T) {
		args := map[string]any{
			"filePath": "hello.txt",
			"limit":    0,
		}
		res := toolRead(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "limit must be > 0")
		assert.Equal(t, args, res.Input)

		args["limit"] = -1
		res = toolRead(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "limit must be > 0")
		assert.Equal(t, args, res.Input)
	})

	t.Run("read clamps excessive line limits", func(t *testing.T) {
		lines := make([]string, maxReadLineLimit+25)
		for i := range lines {
			lines[i] = "line"
		}
		err = os.WriteFile(filepath.Join(tmpDir, "many-lines.txt"), []byte(strings.Join(lines, "\n")), 0600)
		require.NoError(t, err)

		res := toolRead(ctx, map[string]any{
			"filePath": "many-lines.txt",
			"limit":    maxReadLineLimit + 1_000_000,
		})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "Use 'offset' parameter to read beyond line 2000")
		assert.NotContains(t, res.Output, "02001|")
		assert.Equal(t, true, res.Metadata["truncated"])
	})

	t.Run("read binary file", func(t *testing.T) {
		binFile := filepath.Join(tmpDir, "test.bin")
		err = os.WriteFile(binFile, []byte{0, 1, 2, 3, 4, 5, 0, 0, 0, 0}, 0600)
		require.NoError(t, err)

		args := map[string]any{"filePath": "test.bin"}
		res := toolRead(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Cannot read binary file")
	})

	t.Run("read text truncates at byte limit", func(t *testing.T) {
		lines := make([]string, 80)
		for i := range lines {
			lines[i] = strings.Repeat("x", 900)
		}
		err = os.WriteFile(filepath.Join(tmpDir, "large.txt"), []byte(strings.Join(lines, "\n")), 0600)
		require.NoError(t, err)

		res := toolRead(ctx, map[string]any{"filePath": "large.txt"})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "Output truncated at 51200 bytes")
		assert.Equal(t, true, res.Metadata["truncated"])
	})

	t.Run("read pdf success", func(t *testing.T) {
		pdfFile := filepath.Join(tmpDir, "test.pdf")
		err = os.WriteFile(pdfFile, []byte("%PDF-1.4"), 0600)
		require.NoError(t, err)

		args := map[string]any{"filePath": "test.pdf"}
		res := toolRead(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "PDF read successfully")
	})

	t.Run("read image returns attachment metadata with instruction loaded paths", func(t *testing.T) {
		err = os.WriteFile(filepath.Join(tmpDir, "diagram.png"), []byte{
			0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		}, 0600)
		require.NoError(t, err)
		resolver := stubInstructionResolver{
			entries: map[string][]protocol.InstructionEntry{
				filepath.ToSlash(filepath.Join(tmpDir, "diagram.png")): {
					{Path: "/instructions/AGENTS.md", Content: "Use typed errors"},
					{Path: "/instructions/README.md"},
				},
			},
		}
		imageCtx := protocol.ToolContext{
			Ctx:         context.Background(),
			Cwd:         tmpDir,
			ReadFiles:   map[string]bool{},
			Instruction: resolver,
		}

		res := toolRead(imageCtx, map[string]any{"filePath": "diagram.png"})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, "Image read successfully", res.Output)
		assert.Len(t, res.Attachments, 1)
		assert.Equal(t, "Image read successfully", res.Metadata["preview"])
		assert.Equal(t, false, res.Metadata["truncated"])
		assert.Equal(t, []string{"/instructions/AGENTS.md", "/instructions/README.md"}, res.Metadata["loaded"])
		assert.Equal(t, "file", res.Attachments[0]["type"])
		assert.Equal(t, "image/png", res.Attachments[0]["mime"])
		urlValue, ok := res.Attachments[0]["url"].(string)
		assert.True(t, ok)
		assert.True(t, strings.HasPrefix(urlValue, "data:image/png;base64,"))
		assert.True(t, imageCtx.ReadFiles["diagram.png"])
	})

	t.Run("read oversized image fails before attachment encoding", func(t *testing.T) {
		target := filepath.Join(tmpDir, "oversized.png")
		data := append([]byte{
			0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		}, []byte(strings.Repeat("x", maxReadFileBytes))...)
		err = os.WriteFile(target, data, 0600)
		require.NoError(t, err)

		imageCtx := protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       tmpDir,
			ReadFiles: map[string]bool{},
		}
		res := toolRead(imageCtx, map[string]any{"filePath": "oversized.png"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "File exceeds read limit")
		assert.Empty(t, res.Attachments)
		assert.False(t, imageCtx.ReadFiles["oversized.png"])
	})

	t.Run("read text includes reminders and caps preview lines", func(t *testing.T) {
		longLine := strings.Repeat("z", 2105)
		lines := []string{longLine}
		for range 24 {
			lines = append(lines, "line")
		}
		target := filepath.Join(tmpDir, "with-reminders.txt")
		err = os.WriteFile(target, []byte(strings.Join(lines, "\n")), 0600)
		require.NoError(t, err)
		resolver := stubInstructionResolver{
			entries: map[string][]protocol.InstructionEntry{
				filepath.ToSlash(target): {
					{Path: "/instructions/read.md", Content: "Use safe edits"},
					{Content: "Keep diagnostics structured"},
				},
			},
		}
		textCtx := protocol.ToolContext{
			Ctx:         context.Background(),
			Cwd:         tmpDir,
			ReadFiles:   map[string]bool{},
			Instruction: resolver,
		}
		res := toolRead(textCtx, map[string]any{"filePath": "with-reminders.txt"})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "<system-reminder>")
		assert.Contains(t, res.Output, "Use safe edits")
		assert.Contains(t, res.Output, "Keep diagnostics structured")
		assert.Contains(t, res.Output, strings.Repeat("z", 2000)+"...")
		assert.Equal(t, []string{"/instructions/read.md"}, res.Metadata["loaded"])
		preview, ok := res.Metadata["preview"].(string)
		assert.True(t, ok)
		assert.Len(t, strings.Split(preview, "\n"), 20)
	})
}

func BenchmarkFormatTextReadLargeFileWindow(b *testing.B) {
	var body strings.Builder
	for i := range 20000 {
		if i > 0 {
			body.WriteByte('\n')
		}
		body.WriteString("line ")
		body.WriteString(strings.Repeat("x", 120))
	}
	data := []byte(body.String())

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		output, preview, truncated := formatTextRead(data, 15000, 100, false)
		if !truncated {
			b.Fatal("expected large file read to be truncated")
		}
		if len(preview) != 100 {
			b.Fatalf("preview lines = %d, want 100", len(preview))
		}
		if !strings.Contains(output, "15001|") {
			b.Fatal("expected output to start at requested offset")
		}
	}
}

func TestTruncateUTF16(t *testing.T) {
	tests := []struct {
		input    string
		limit    int
		expected string
	}{
		{"hello", 10, "hello"},
		{"hello", 3, "hel"},
		{"hello", 5, "hello"},
		{"hello", 0, ""},
		{"😀", 2, "😀"},
		{"😀", 1, ""},
		{"a😀b", 2, "a"},
		{"a😀b", 3, "a😀"},
	}

	for _, tt := range tests {
		assert.Equal(t, tt.expected, truncateUTF16(tt.input, tt.limit))
	}
}

func TestToInt(t *testing.T) {
	tests := []struct {
		input      any
		expected   int
		expectedOk bool
	}{
		{10, 10, true},
		{int64(20), 20, true},
		{float64(30.5), 30, true},
		{"40", 40, true},
		{"invalid", 0, false},
		{true, 0, false},
	}

	for _, tt := range tests {
		val, ok := toInt(tt.input)
		assert.Equal(t, tt.expected, val)
		assert.Equal(t, tt.expectedOk, ok)
	}
}

func TestIsBinaryFileHeuristics(t *testing.T) {
	assert.False(t, isBinaryFile("empty.txt", nil))
	assert.True(t, isBinaryFile("archive.zip", []byte("plain text")))
	assert.True(t, isBinaryFile("invalid.txt", []byte{0xff, 0xfe}))
	assert.True(t, isBinaryFile("nul.txt", []byte{'a', 0, 'b'}))
	assert.True(t, isBinaryFile("controls.txt", []byte{1, 2, 3, 4, 5, 6, 7, 'a', 'b', 'c'}))
	assert.False(t, isBinaryFile("plain.txt", []byte("hello\nworld\tok")))
}
