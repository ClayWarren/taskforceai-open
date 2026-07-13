package tools

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type ioDenyPermission struct{}

func (ioDenyPermission) Ask(protocol.PermissionRequest) error {
	return errors.New("external access denied")
}

type allowPermission struct{}

func (allowPermission) Ask(protocol.PermissionRequest) error { return nil }

func toolTestCtx(t *testing.T) protocol.ToolContext {
	return protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       t.TempDir(),
		ReadFiles: map[string]bool{},
	}
}

func TestToolsCoreCoverageGapPaths(t *testing.T) {
	ctx := toolTestCtx(t)
	tmpDir := ctx.Cwd

	t.Run("archive success and no-files-added error", func(t *testing.T) {
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "one.txt"), []byte("one"), 0o600))
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "two.txt"), []byte("two"), 0o600))
		ctx.ReadFiles["one.txt"] = true
		ctx.ReadFiles["two.txt"] = true

		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		ok := toolCreateArchive(ctx, map[string]any{
			"filePath": "bundle.zip",
			"files":    []any{"one.txt", "two.txt", 123, ""},
		})
		assert.Equal(t, "completed", ok.Status)
		assert.Equal(t, 2, ok.Metadata["files_added"])
		assert.Len(t, writer.requests, 1)

		useArchiveWriter(t, &fakeArchiveFileWriter{})
		missing := toolCreateArchive(ctx, map[string]any{
			"filePath": "empty.zip",
			"files":    []any{"missing-a.txt", "missing-b.txt"},
		})
		assert.Equal(t, "error", missing.Status)
		assert.Contains(t, missing.Error, "No files could be added")
	})

	t.Run("presentation success and max slide guard", func(t *testing.T) {
		slides := make([]any, MaxPresentationSlides+1)
		for i := range slides {
			slides[i] = map[string]any{"title": "slide"}
		}
		tooMany := toolCreatePresentation(ctx, map[string]any{
			"filePath": "big.pptx",
			"slides":   slides,
		})
		assert.Equal(t, "error", tooMany.Status)

		writer := &fakePresentationWriter{}
		usePresentationWriter(t, writer)
		res := toolCreatePresentation(ctx, map[string]any{
			"filePath": "deck.pptx",
			"slides": []any{
				map[string]any{"title": "Intro", "body": "Welcome"},
				map[string]any{"title": "Details"},
				"skip-me",
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.True(t, res.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("glob honors brace expansion and gitignored files", func(t *testing.T) {
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "keep.txt"), []byte("x"), 0o600))
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "skip.log"), []byte("x"), 0o600))
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("*.log\n"), 0o600))

		res := toolGlob(ctx, map[string]any{
			"path":    ".",
			"pattern": "*.{txt,log}",
		})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "keep.txt")
		assert.NotContains(t, res.Output, "skip.log")
	})

	t.Run("edit replace existing content and rejects identical strings", func(t *testing.T) {
		path := filepath.Join(tmpDir, "edit-me.txt")
		require.NoError(t, os.WriteFile(path, []byte("alpha beta"), 0o600))
		ctx.ReadFiles["edit-me.txt"] = true

		same := toolEdit(ctx, map[string]any{
			"filePath":  "edit-me.txt",
			"oldString": "beta",
			"newString": "beta",
		})
		assert.Equal(t, "error", same.Status)

		updated := toolEdit(ctx, map[string]any{
			"filePath":  "edit-me.txt",
			"oldString": "beta",
			"newString": "gamma",
		})
		assert.Equal(t, "completed", updated.Status)
	})

	t.Run("edit rejects directory paths unread files and creates new files", func(t *testing.T) {
		assertDir := toolEdit(ctx, map[string]any{
			"filePath":  "dir/",
			"oldString": "a",
			"newString": "b",
		})
		assert.Equal(t, "error", assertDir.Status)

		existing := filepath.Join(tmpDir, "needs-read.txt")
		require.NoError(t, os.WriteFile(existing, []byte("old"), 0o600))
		mustRead := toolEdit(ctx, map[string]any{
			"filePath":  "needs-read.txt",
			"oldString": "old",
			"newString": "new",
		})
		assert.Equal(t, "error", mustRead.Status)
		assert.Contains(t, mustRead.Error, "must read file")

		createRes := toolEdit(ctx, map[string]any{
			"filePath":  "nested/new.txt",
			"oldString": "",
			"newString": "created",
		})
		assert.Equal(t, "completed", createRes.Status)
	})

	t.Run("glob handles missing search path and empty matches", func(t *testing.T) {
		missing := toolGlob(ctx, map[string]any{
			"path":    "missing-dir",
			"pattern": "*.txt",
		})
		assert.Equal(t, "error", missing.Status)

		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "one.txt"), []byte("x"), 0o600))
		noMatch := toolGlob(ctx, map[string]any{
			"path":    ".",
			"pattern": "*.pdf",
		})
		assert.Equal(t, "completed", noMatch.Status)
		assert.Contains(t, noMatch.Output, "No files found")
	})

	t.Run("write rejects directories and unread overwrites", func(t *testing.T) {
		dirRes := toolWrite(ctx, map[string]any{
			"filePath": "folder/",
			"content":  "x",
		})
		assert.Equal(t, "error", dirRes.Status)

		path := filepath.Join(tmpDir, "protected.txt")
		require.NoError(t, os.WriteFile(path, []byte("old"), 0o600))
		unread := toolWrite(ctx, map[string]any{
			"filePath": "protected.txt",
			"content":  "new",
		})
		assert.Equal(t, "error", unread.Status)
	})

	t.Run("spreadsheet rejects too many rows and creates multi-sheet files", func(t *testing.T) {
		rows := make([]any, MaxSpreadsheetRows+1)
		for i := range rows {
			rows[i] = []any{"cell"}
		}
		tooMany := toolCreateSpreadsheet(ctx, map[string]any{
			"filePath": "big.xlsx",
			"sheets": []any{
				map[string]any{
					"name": "SheetA",
					"rows": rows,
				},
			},
		})
		assert.Equal(t, "error", tooMany.Status)

		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		ok := toolCreateSpreadsheet(ctx, map[string]any{
			"filePath": "book.xlsx",
			"sheets": []any{
				map[string]any{
					"name": "Summary",
					"rows": []any{[]any{"a", "b"}},
				},
				map[string]any{
					"name": "Details",
					"rows": []any{[]any{"1", "2"}},
				},
			},
		})
		assert.Equal(t, "completed", ok.Status)
		assert.True(t, ok.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("archive skips non-string entries and reports added count", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "keep.txt"), []byte("data"), 0o600))
		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		res := toolCreateArchive(ctx, map[string]any{
			"filePath": "bundle.zip",
			"files": []any{
				123,
				"keep.txt",
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, 1, res.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Len(t, writer.requests[0].Entries, 1)
		}
	})

	t.Run("archive rejects too many files", func(t *testing.T) {
		files := make([]any, MaxArchiveFiles+1)
		for i := range files {
			files[i] = "file.txt"
		}
		res := toolCreateArchive(ctx, map[string]any{
			"filePath": "too-many.zip",
			"files":    files,
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")
	})

	t.Run("archive skips invalid entries and reports writer-added count", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "good.txt"), []byte("ok"), 0o600))
		writer := &fakeArchiveFileWriter{filesAdded: 1}
		useArchiveWriter(t, writer)
		res := toolCreateArchive(ctx, map[string]any{
			"filePath": "mixed.zip",
			"files":    []any{123, "", "missing.txt", "good.txt"},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, 1, res.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Len(t, writer.requests[0].Entries, 2)
		}
	})

	t.Run("presentation skips invalid slide entries and uses fallback placeholders", func(t *testing.T) {
		writer := &fakePresentationWriter{}
		usePresentationWriter(t, writer)
		res := toolCreatePresentation(ctx, map[string]any{
			"filePath": "fallback.pptx",
			"slides": []any{
				"skip",
				map[string]any{"title": "Title slide", "body": "Body text"},
				map[string]any{"title": "Another"},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.True(t, res.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("write reports metadata when overwriting existing file", func(t *testing.T) {
		path := filepath.Join(tmpDir, "overwrite.txt")
		require.NoError(t, os.WriteFile(path, []byte("old"), 0o600))
		ctx.ReadFiles["overwrite.txt"] = true
		res := toolWrite(ctx, map[string]any{
			"filePath": "overwrite.txt",
			"content":  "new",
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, true, res.Metadata["exists"])
	})
}

func TestToolsExtensiveCoverageGapPaths(t *testing.T) {
	tmpDir := t.TempDir()
	baseCtx := protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       tmpDir,
		ReadFiles: map[string]bool{},
	}

	t.Run("edit external path mkdir write and overwrite failures", func(t *testing.T) {
		external := toolEdit(protocol.ToolContext{
			Ctx:        context.Background(),
			Cwd:        tmpDir,
			ReadFiles:  map[string]bool{},
			Permission: ioDenyPermission{},
		}, map[string]any{
			"filePath":  "../outside.txt",
			"oldString": "",
			"newString": "new",
		})
		assert.Equal(t, "error", external.Status)

		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "blocked"), []byte("x"), 0o600))
		mkdirFail := toolEdit(baseCtx, map[string]any{
			"filePath":  "blocked/new.txt",
			"oldString": "",
			"newString": "new",
		})
		assert.Equal(t, "error", mkdirFail.Status)

		readOnlyDir := filepath.Join(tmpDir, "readonly")
		require.NoError(t, os.Mkdir(readOnlyDir, 0o500))
		t.Cleanup(func() { _ = os.Chmod(readOnlyDir, 0o700) })
		createFail := toolEdit(baseCtx, map[string]any{
			"filePath":  "readonly/new.txt",
			"oldString": "",
			"newString": "new",
		})
		assert.Equal(t, "error", createFail.Status)

		target := filepath.Join(tmpDir, "locked.txt")
		assert.NoError(t, os.WriteFile(target, []byte("alpha"), 0o600))
		baseCtx.ReadFiles["locked.txt"] = true
		assert.NoError(t, os.Chmod(target, 0o400))
		t.Cleanup(func() { _ = os.Chmod(target, 0o600) })
		writeFail := toolEdit(baseCtx, map[string]any{
			"filePath":  "locked.txt",
			"oldString": "alpha",
			"newString": "beta",
		})
		assert.Equal(t, "error", writeFail.Status)
	})

	t.Run("glob handles missing paths external directories and cancelled context", func(t *testing.T) {
		missing := toolGlob(baseCtx, map[string]any{
			"path":    "missing-dir",
			"pattern": "*.txt",
		})
		assert.Equal(t, "error", missing.Status)

		external := toolGlob(protocol.ToolContext{
			Ctx:        context.Background(),
			Cwd:        tmpDir,
			Permission: ioDenyPermission{},
		}, map[string]any{
			"path":    "../outside",
			"pattern": "*.txt",
		})
		assert.Equal(t, "error", external.Status)

		cancelledCtx, cancel := context.WithCancel(context.Background())
		cancel()
		cancelled := toolGlob(protocol.ToolContext{
			Ctx: cancelledCtx,
			Cwd: tmpDir,
		}, map[string]any{
			"path":    ".",
			"pattern": "*.txt",
		})
		assert.Equal(t, "error", cancelled.Status)

		assert.NotEmpty(t, expandBrace("*.{a,b}"))
	})

	t.Run("grep handles unreadable files and invalid regex", func(t *testing.T) {
		invalid := toolGrep(baseCtx, map[string]any{
			"path":    ".",
			"pattern": "[",
		})
		assert.Equal(t, "error", invalid.Status)

		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "scan.txt"), []byte("needle here"), 0o600))
		unreadable := filepath.Join(tmpDir, "secret.txt")
		assert.NoError(t, os.WriteFile(unreadable, []byte("needle"), 0o600))
		assert.NoError(t, os.Chmod(unreadable, 0o000))
		t.Cleanup(func() { _ = os.Chmod(unreadable, 0o600) })
		walkFail := toolGrep(baseCtx, map[string]any{
			"path":    ".",
			"pattern": "needle",
		})
		assert.Equal(t, "error", walkFail.Status)
	})

	t.Run("csv create success and error branches", func(t *testing.T) {
		external := toolCreateCSV(protocol.ToolContext{
			Ctx:        context.Background(),
			Cwd:        tmpDir,
			Permission: ioDenyPermission{},
		}, map[string]any{
			"filePath": "../outside.csv",
			"rows":     []any{[]any{"a"}},
		})
		assert.Equal(t, "error", external.Status)

		useCSVFileWriter(t, &fakeCSVFileWriter{
			err: CSVWriteError{Kind: CSVWriteFailureFile, Err: errors.New("create failed")},
		})
		createFail := toolCreateCSV(baseCtx, map[string]any{
			"filePath": "blocked.csv",
			"rows":     []any{[]any{"a"}},
		})
		assert.Equal(t, "error", createFail.Status)

		csvWriter := &fakeCSVFileWriter{}
		useCSVFileWriter(t, csvWriter)
		ok := toolCreateCSV(baseCtx, map[string]any{
			"filePath": "data.csv",
			"rows": []any{
				[]any{"name", "value"},
				[]any{"alpha", 1},
				"skip",
			},
		})
		assert.Equal(t, "completed", ok.Status)
		assert.Len(t, csvWriter.requests, 1)
	})

	t.Run("archive create temp rename and skip branches", func(t *testing.T) {
		baseCtx.ReadFiles["keep.txt"] = true
		useArchiveWriter(t, &fakeArchiveFileWriter{
			err: ArchiveWriteError{Kind: ArchiveWriteFailureCreate, Err: errors.New("create failed")},
		})
		tempFail := toolCreateArchive(baseCtx, map[string]any{
			"filePath": "parent.zip/nested.zip",
			"files":    []any{"keep.txt"},
		})
		assert.Equal(t, "error", tempFail.Status)

		useArchiveWriter(t, &fakeArchiveFileWriter{
			err: ArchiveWriteError{Kind: ArchiveWriteFailureSave, Err: errors.New("rename failed")},
		})
		renameFail := toolCreateArchive(baseCtx, map[string]any{
			"filePath": "bundle.zip",
			"files":    []any{"keep.txt"},
		})
		assert.Equal(t, "error", renameFail.Status)
	})

	t.Run("spreadsheet handles external path and cell errors", func(t *testing.T) {
		external := toolCreateSpreadsheet(protocol.ToolContext{
			Ctx:        context.Background(),
			Cwd:        tmpDir,
			Permission: ioDenyPermission{},
		}, map[string]any{
			"filePath": "../outside.xlsx",
			"sheets":   []any{map[string]any{"name": "S1", "rows": []any{[]any{"a"}}}},
		})
		assert.Equal(t, "error", external.Status)

		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		res := toolCreateSpreadsheet(baseCtx, map[string]any{
			"filePath": "book.xlsx",
			"sheets": []any{
				map[string]any{"name": "First", "rows": []any{[]any{"ok"}}},
				"skip",
				map[string]any{"name": "Second", "rows": []any{"bad-row"}},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("presentation layout fallback and save success", func(t *testing.T) {
		writer := &fakePresentationWriter{}
		usePresentationWriter(t, writer)
		res := toolCreatePresentation(baseCtx, map[string]any{
			"filePath": "layout.pptx",
			"slides": []any{
				map[string]any{"title": "Only Title"},
				map[string]any{"body": "Only Body"},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Len(t, writer.requests, 1)
	})
}

func TestToolsFinalPushTo95CoverageGapPaths(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir, ReadFiles: map[string]bool{}}

	t.Run("write guards overwrite rename and external path labels", func(t *testing.T) {
		existing := filepath.Join(tmpDir, "existing.txt")
		require.NoError(t, os.WriteFile(existing, []byte("old"), 0o600))
		mustRead := toolWrite(ctx, map[string]any{
			"filePath": "existing.txt",
			"content":  "new",
		})
		assert.Equal(t, "error", mustRead.Status)
		assert.Contains(t, mustRead.Error, "read file")

		outside := filepath.Join(filepath.Dir(tmpDir), "outside-write.txt")
		require.NoError(t, os.WriteFile(outside, []byte("outside"), 0o600))
		t.Cleanup(func() { _ = os.Remove(outside) })
		ctx.ReadFiles["../outside-write.txt"] = false
		outsideRes := toolWrite(ctx, map[string]any{
			"filePath": "../outside-write.txt",
			"content":  "blocked",
		})
		assert.Equal(t, "error", outsideRes.Status)

		blocker := filepath.Join(tmpDir, "blocked")
		require.NoError(t, os.WriteFile(blocker, []byte("x"), 0o600))
		mkdirFail := toolWrite(ctx, map[string]any{
			"filePath": "blocked/nested.txt",
			"content":  "data",
		})
		assert.Equal(t, "error", mkdirFail.Status)

		targetDir := filepath.Join(tmpDir, "target-dir")
		require.NoError(t, os.Mkdir(targetDir, 0o750))
		renameFail := toolWrite(ctx, map[string]any{
			"filePath": "target-dir",
			"content":  "data",
		})
		assert.Equal(t, "error", renameFail.Status)
	})

	t.Run("webfetch reads successful responses and reports transport failures", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{response: WebFetchResponse{
			StatusCode: 200,
			Body:       []byte("hello web"),
		}})
		ok := toolWebFetch(ctx, map[string]any{"url": "https://example.com"})
		assert.Equal(t, "completed", ok.Status)
		assert.Equal(t, "hello web", ok.Output)

		useWebFetchSource(t, &fakeWebFetchSource{err: ErrWebFetchConnection})
		badHost := toolWebFetch(ctx, map[string]any{"url": "http://127.0.0.1:1/"})
		assert.Equal(t, "error", badHost.Status)
	})

	t.Run("create chart and presentation success paths", func(t *testing.T) {
		chartWriter := &fakeChartWriter{}
		useChartWriter(t, chartWriter)
		chartRes := toolCreateChart(ctx, map[string]any{
			"filePath": "chart.svg",
			"type":     "bar",
			"title":    "Counts",
			"data": []any{
				map[string]any{"label": "A", "value": 1},
				map[string]any{"label": "B", "value": 2},
			},
		})
		assert.Equal(t, "completed", chartRes.Status)
		assert.Len(t, chartWriter.requests, 1)

		writer := &fakePresentationWriter{}
		usePresentationWriter(t, writer)
		presentationRes := toolCreatePresentation(ctx, map[string]any{
			"filePath": "deck.pptx",
			"slides": []any{
				map[string]any{"title": "Intro", "body": "Body"},
				map[string]any{"title": "Next"},
			},
		})
		assert.Equal(t, "completed", presentationRes.Status)
		assert.True(t, presentationRes.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("archive reports writer-added count for approved members", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "good.txt"), []byte("ok"), 0o600))
		require.NoError(t, os.Mkdir(filepath.Join(tmpDir, "folder"), 0o750))
		secret := filepath.Join(tmpDir, "secret.txt")
		require.NoError(t, os.WriteFile(secret, []byte("secret"), 0o600))
		require.NoError(t, os.Chmod(secret, 0o000))
		t.Cleanup(func() { _ = os.Chmod(secret, 0o600) })

		readCtx := protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       tmpDir,
			ReadFiles: map[string]bool{"good.txt": true, "folder": true, "secret.txt": true},
		}
		writer := &fakeArchiveFileWriter{filesAdded: 1}
		useArchiveWriter(t, writer)
		res := toolCreateArchive(readCtx, map[string]any{
			"filePath": "mixed.zip",
			"files":    []any{"good.txt", "folder", "secret.txt"},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, 1, res.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Len(t, writer.requests[0].Entries, 3)
		}
	})
}

func TestToolsMiscCoverageGapPaths(t *testing.T) {
	tmpDir := t.TempDir()
	ioCtx := protocol.ToolContext{
		Ctx:        context.Background(),
		Cwd:        tmpDir,
		ReadFiles:  map[string]bool{},
		Permission: ioDenyPermission{},
	}

	t.Run("archive write and presentation reject external paths", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "keep.txt"), []byte("data"), 0o600))
		ioCtx.ReadFiles["keep.txt"] = true

		archiveRes := toolCreateArchive(ioCtx, map[string]any{
			"filePath": "../outside.zip",
			"files":    []any{"keep.txt"},
		})
		assert.Equal(t, "error", archiveRes.Status)
		assert.Contains(t, archiveRes.Error, "external access denied")

		presentationRes := toolCreatePresentation(ioCtx, map[string]any{
			"filePath": "../outside.pptx",
			"slides":   []any{map[string]any{"title": "Slide"}},
		})
		assert.Equal(t, "error", presentationRes.Status)
		assert.Contains(t, presentationRes.Error, "external access denied")
	})

	t.Run("write surfaces mkdir write and rename failures", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "blocked"), []byte("x"), 0o600))
		mkdirRes := toolWrite(ioCtx, map[string]any{
			"filePath": "blocked/child.txt",
			"content":  "child",
		})
		assert.Equal(t, "error", mkdirRes.Status)

		target := filepath.Join(tmpDir, "target.txt")
		require.NoError(t, os.Mkdir(target, 0o750))
		renameRes := toolWrite(ioCtx, map[string]any{
			"filePath": "target.txt",
			"content":  "data",
		})
		assert.Equal(t, "error", renameRes.Status)

		readOnlyDir := filepath.Join(tmpDir, "readonly")
		require.NoError(t, os.Mkdir(readOnlyDir, 0o500))
		t.Cleanup(func() { _ = os.Chmod(readOnlyDir, 0o700) })
		writeRes := toolWrite(protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       tmpDir,
			ReadFiles: map[string]bool{},
		}, map[string]any{
			"filePath": "readonly/new.txt",
			"content":  "blocked",
		})
		assert.Equal(t, "error", writeRes.Status)
	})

	t.Run("archive rename failure after successful zip build", func(t *testing.T) {
		readCtx := protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       tmpDir,
			ReadFiles: map[string]bool{"keep.txt": true},
		}
		useArchiveWriter(t, &fakeArchiveFileWriter{
			err: ArchiveWriteError{Kind: ArchiveWriteFailureSave, Err: errors.New("rename failed")},
		})

		res := toolCreateArchive(readCtx, map[string]any{
			"filePath": "bundle.zip",
			"files":    []any{"keep.txt"},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Error saving archive")
	})

	t.Run("presentation success", func(t *testing.T) {
		writer := &fakePresentationWriter{}
		usePresentationWriter(t, writer)
		res := toolCreatePresentation(protocol.ToolContext{Cwd: tmpDir}, map[string]any{
			"filePath": "deck.pptx",
			"slides": []any{
				map[string]any{"title": "Intro", "body": "Welcome"},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.True(t, res.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir, ReadFiles: map[string]bool{}}

	t.Run("chart supports pie png output and numeric coercion", func(t *testing.T) {
		assert.Equal(t, float64(3), toFloat(3))
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		res := toolCreateChart(ctx, map[string]any{
			"filePath": "pie.png",
			"type":     "pie",
			"title":    "Share",
			"data": []any{
				map[string]any{"label": "A", "value": 1},
				map[string]any{"label": "B", "value": 2},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("spreadsheet rejects excessive row counts", func(t *testing.T) {
		rows := make([]any, MaxSpreadsheetRows+1)
		for i := range rows {
			rows[i] = []any{"x"}
		}
		res := toolCreateSpreadsheet(ctx, map[string]any{
			"filePath": "big.xlsx",
			"sheets": []any{
				map[string]any{"name": "Sheet1", "rows": rows},
			},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")
	})

	t.Run("write uses full path label for external overwrite guard", func(t *testing.T) {
		outside := filepath.Join(filepath.Dir(tmpDir), "outside-overwrite.txt")
		require.NoError(t, os.WriteFile(outside, []byte("old"), 0o600))
		t.Cleanup(func() { _ = os.Remove(outside) })

		externalCtx := protocol.ToolContext{
			Ctx:        context.Background(),
			Cwd:        tmpDir,
			ReadFiles:  map[string]bool{},
			Permission: allowPermission{},
		}
		res := toolWrite(externalCtx, map[string]any{
			"filePath": "../outside-overwrite.txt",
			"content":  "new",
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "read file")
	})

	t.Run("edit and document tools cover success paths when licensed", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "edit.txt"), []byte("before\n"), 0o600))
		editRes := toolEdit(protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       tmpDir,
			ReadFiles: map[string]bool{"edit.txt": true},
		}, map[string]any{
			"filePath":  "edit.txt",
			"oldString": "before",
			"newString": "after",
		})
		assert.Equal(t, "completed", editRes.Status)

		writer := &fakeDocumentWriter{}
		useDocumentWriter(t, writer)
		docRes := toolCreateDocument(ctx, map[string]any{
			"filePath": "doc.docx",
			"title":    "Title",
			"sections": []any{
				map[string]any{"heading": "Section", "content": "Body"},
			},
		})
		assert.Equal(t, "completed", docRes.Status)
		assert.True(t, docRes.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("create pdf succeeds", func(t *testing.T) {
		writer := &fakePDFWriter{}
		usePDFWriter(t, writer)
		res := toolCreatePDF(ctx, map[string]any{
			"filePath": "report.pdf",
			"title":    "Report",
			"sections": []any{
				map[string]any{"heading": "Intro", "content": "Body"},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("grep reports stat errors that are not missing paths", func(t *testing.T) {
		require.NoError(t, os.Chmod(tmpDir, 0o000))
		t.Cleanup(func() { _ = os.Chmod(tmpDir, 0o700) })

		res := toolGrep(protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}, map[string]any{
			"path":    ".",
			"pattern": "needle",
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Error:")
	})

	t.Run("archive handles temp creation and skipped member files", func(t *testing.T) {
		baseCtx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir, ReadFiles: map[string]bool{}}

		useArchiveWriter(t, &fakeArchiveFileWriter{
			err: ArchiveWriteError{Kind: ArchiveWriteFailureCreate, Err: errors.New("create failed")},
		})
		tempFail := toolCreateArchive(baseCtx, map[string]any{
			"filePath": "blocked/out.zip",
			"files":    []any{"missing.txt"},
		})
		assert.Equal(t, "error", tempFail.Status)

		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "good.txt"), []byte("data"), 0o600))
		baseCtx.ReadFiles["good.txt"] = true
		outsidePath := filepath.Join(filepath.Dir(tmpDir), "outside.txt")
		require.NoError(t, os.WriteFile(outsidePath, []byte("outside"), 0o600))
		t.Cleanup(func() { _ = os.Remove(outsidePath) })
		baseCtx.ReadFiles["../outside.txt"] = true

		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		partial := toolCreateArchive(baseCtx, map[string]any{
			"filePath": "partial.zip",
			"files":    []any{"good.txt", "../outside.txt"},
		})
		assert.Equal(t, "completed", partial.Status)
		assert.Equal(t, 1, partial.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Len(t, writer.requests[0].Entries, 1)
		}

		useArchiveWriter(t, &fakeArchiveFileWriter{})
		empty := toolCreateArchive(baseCtx, map[string]any{
			"filePath": "empty.zip",
			"files":    []any{"missing-only.txt"},
		})
		assert.Equal(t, "error", empty.Status)
		assert.Contains(t, empty.Error, "No files could be added")
	})

	t.Run("glob expand brace and spreadsheet success path", func(t *testing.T) {
		assert.Equal(t, []string{"a.txt", "b.txt"}, expandBrace("{a,b}.txt"))
		assert.Equal(t, []string{"plain.txt"}, expandBrace("plain.txt"))

		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "sheet.csv"), []byte("a"), 0o600))
		globRes := toolGlob(protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}, map[string]any{
			"pattern": "*.{csv,txt}",
		})
		assert.Equal(t, "completed", globRes.Status)

		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		sheetRes := toolCreateSpreadsheet(protocol.ToolContext{Cwd: tmpDir}, map[string]any{
			"filePath": "report.xlsx",
			"sheets": []any{
				map[string]any{
					"name": "Summary",
					"rows": []any{
						[]any{"Metric", "Value"},
						[]any{"Rows", 2},
					},
				},
				map[string]any{
					"name": "Details",
					"rows": []any{[]any{"Item", "Count"}},
				},
			},
		})
		assert.Equal(t, "completed", sheetRes.Status)
		assert.True(t, sheetRes.TitleSet)
		assert.Len(t, writer.requests, 1)
	})

	baseCtx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}

	t.Run("webfetch validation and ssrf guards", func(t *testing.T) {
		missing := toolWebFetch(baseCtx, map[string]any{})
		assert.Equal(t, "error", missing.Status)

		badScheme := toolWebFetch(baseCtx, map[string]any{"url": "ftp://example.com"})
		assert.Contains(t, badScheme.Error, "http:// or https://")

		invalid := toolWebFetch(baseCtx, map[string]any{"url": "http://%zz"})
		assert.Contains(t, invalid.Error, "invalid URL")

		useWebFetchSource(t, &fakeWebFetchSource{err: ErrWebFetchPrivateAddress})
		private := toolWebFetch(baseCtx, map[string]any{"url": "http://127.0.0.1/"})
		assert.Contains(t, private.Error, "private/internal")
	})

	t.Run("grep truncated matches", func(t *testing.T) {
		content := strings.Builder{}
		for range 110 {
			content.WriteString("match\n")
		}
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "many.txt"), []byte(content.String()), 0o600))
		truncated := toolGrep(baseCtx, map[string]any{
			"path":    ".",
			"pattern": "match",
		})
		assert.Equal(t, "completed", truncated.Status)
		assert.Equal(t, true, truncated.Metadata["truncated"])
	})

	t.Run("archive skips read-denied files and enforces external access", func(t *testing.T) {
		readable := filepath.Join(tmpDir, "readable.txt")
		secret := filepath.Join(tmpDir, "secret.txt")
		assert.NoError(t, os.WriteFile(readable, []byte("ok"), 0o600))
		assert.NoError(t, os.WriteFile(secret, []byte("secret"), 0o600))
		assert.NoError(t, os.Chmod(secret, 0o000))
		t.Cleanup(func() { _ = os.Chmod(secret, 0o600) })

		ctx := protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       tmpDir,
			ReadFiles: map[string]bool{"readable.txt": true, "secret.txt": true},
			Permission: selectivePermission{denied: map[string]bool{
				"secret.txt": true,
			}},
		}
		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		res := toolCreateArchive(ctx, map[string]any{
			"filePath": "partial.zip",
			"files":    []any{"readable.txt", "secret.txt"},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, 1, res.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Len(t, writer.requests[0].Entries, 1)
		}
	})
}
