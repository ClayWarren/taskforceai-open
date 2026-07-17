package filesystem

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/patch"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newApplyPatchCtx(t *testing.T) (protocol.ToolContext, string) {
	t.Helper()
	tmpDir := t.TempDir()
	return protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       tmpDir,
		ReadFiles: map[string]bool{},
	}, tmpDir
}

type removeErrorFileSystem struct {
	testsupport.OSFileSystem
}

func (removeErrorFileSystem) Remove(string) error { return errors.New("remove failed") }

func TestExecuteApplyPatchAdd(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)

	patch := "*** Begin Patch\n" +
		"*** Add File: hello.txt\n" +
		"+Hello world\n" +
		"+Second line\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.Contains(t, res.Output, "hello.txt")

	data := mustReadTestFile(t, filepath.Join(tmpDir, "hello.txt"))
	assert.Equal(t, "Hello world\nSecond line", string(data))
}

func TestExecuteApplyPatchDelete(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	target := filepath.Join(tmpDir, "gone.txt")
	require.NoError(t, os.WriteFile(target, []byte("bye"), 0o600))

	patch := "*** Begin Patch\n" +
		"*** Delete File: gone.txt\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.NoFileExists(t, target)
}

func TestExecuteApplyPatchUpdateExact(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	target := filepath.Join(tmpDir, "update.txt")
	require.NoError(t, os.WriteFile(target, []byte("line1\nline2\nline3"), 0o600))
	ctx.ReadFiles["update.txt"] = true

	patch := "*** Begin Patch\n" +
		"*** Update File: update.txt\n" +
		"@@\n" +
		" line1\n" +
		"-line2\n" +
		"+line-two\n" +
		" line3\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, "line1\nline-two\nline3", string(mustReadTestFile(t, target)))
}

func TestExecuteApplyPatchUpdatePreservesFinalNewline(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	target := filepath.Join(tmpDir, "update.txt")
	require.NoError(t, os.WriteFile(target, []byte("line1\nline2\n"), 0o600))
	ctx.ReadFiles["update.txt"] = true

	patch := "*** Begin Patch\n" +
		"*** Update File: update.txt\n" +
		"@@\n" +
		" line1\n" +
		"-line2\n" +
		"+line-two\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, "line1\nline-two\n", string(mustReadTestFile(t, target)))
}

func TestExecuteApplyPatchUpdateFuzzyWhitespace(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	target := filepath.Join(tmpDir, "fuzzy.txt")
	// Trailing whitespace on line2 that the patch's context line omits.
	require.NoError(t, os.WriteFile(target, []byte("line1\nline2   \nline3"), 0o600))
	ctx.ReadFiles["fuzzy.txt"] = true

	patch := "*** Begin Patch\n" +
		"*** Update File: fuzzy.txt\n" +
		"@@\n" +
		" line1\n" +
		"-line2\n" +
		"+line-two\n" +
		" line3\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, "line1\nline-two\nline3", string(mustReadTestFile(t, target)))
}

func TestExecuteApplyPatchUpdateWithMove(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	oldPath := filepath.Join(tmpDir, "old.txt")
	newPath := filepath.Join(tmpDir, "new.txt")
	require.NoError(t, os.WriteFile(oldPath, []byte("content"), 0o600))
	ctx.ReadFiles["old.txt"] = true

	patch := "*** Begin Patch\n" +
		"*** Update File: old.txt\n" +
		"*** Move to: new.txt\n" +
		"@@\n" +
		"-content\n" +
		"+moved content\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.NoFileExists(t, oldPath)
	assert.Equal(t, "moved content", string(mustReadTestFile(t, newPath)))
}

func TestExecuteApplyPatchUpdateEndOfFile(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	target := filepath.Join(tmpDir, "eof.txt")
	require.NoError(t, os.WriteFile(target, []byte("a\nb\nc"), 0o600))
	ctx.ReadFiles["eof.txt"] = true

	patch := "*** Begin Patch\n" +
		"*** Update File: eof.txt\n" +
		"@@\n" +
		" c\n" +
		"+d\n" +
		"*** End of File\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, "a\nb\nc\nd", string(mustReadTestFile(t, target)))
}

func TestExecuteApplyPatchRequiresReadFirst(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "guard.txt"), []byte("a"), 0o600))

	patch := "*** Begin Patch\n" +
		"*** Update File: guard.txt\n" +
		"@@\n" +
		"-a\n" +
		"+b\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "you must read file")
}

func TestExecuteApplyPatchPartialFailureReportsAppliedSoFar(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "existing.txt"), []byte("keep"), 0o600))

	patch := "*** Begin Patch\n" +
		"*** Add File: first.txt\n" +
		"+created\n" +
		"*** Delete File: does-not-exist.txt\n" +
		"*** End Patch"

	res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Patch partially applied")
	assert.Contains(t, res.Error, "Applied: first.txt")
	assert.FileExists(t, filepath.Join(tmpDir, "first.txt"))
}

func TestExecuteApplyPatchInvalidGrammar(t *testing.T) {
	ctx, _ := newApplyPatchCtx(t)

	cases := map[string]string{
		"missing begin marker": "*** Add File: a.txt\n+x\n*** End Patch",
		"missing end marker":   "*** Begin Patch\n*** Add File: a.txt\n+x",
		"bad add line prefix":  "*** Begin Patch\n*** Add File: a.txt\nnotplus\n*** End Patch",
		"unexpected line":      "*** Begin Patch\nnonsense\n*** End Patch",
	}
	for name, patch := range cases {
		t.Run(name, func(t *testing.T) {
			res := ExecuteApplyPatch(ctx, map[string]any{"patch": patch})
			assert.Equal(t, "error", res.Status)
		})
	}
}

func TestExecuteApplyPatchMissingArgs(t *testing.T) {
	ctx, _ := newApplyPatchCtx(t)
	res := ExecuteApplyPatch(ctx, map[string]any{})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "invalid arguments")
}

func TestExecuteApplyPatchEmptyPatchBody(t *testing.T) {
	ctx, _ := newApplyPatchCtx(t)
	res := ExecuteApplyPatch(ctx, map[string]any{"patch": "*** Begin Patch\n*** End Patch"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "no file operations")
}

func TestApplyPatchOperationErrorEdges(t *testing.T) {
	ctx, tmpDir := newApplyPatchCtx(t)
	_, _, err := applyPatchOp(ctx, patch.Op{Kind: patch.OpKind("unknown"), Path: "unknown.txt"})
	require.ErrorContains(t, err, "unknown patch operation")

	for _, op := range []patch.Op{
		{Kind: patch.Add, Path: "../outside.txt", AddLines: []string{"x"}},
		{Kind: patch.Delete, Path: "../outside.txt"},
		{Kind: patch.Update, Path: "../outside.txt"},
	} {
		_, _, err = applyPatchOp(ctx, op)
		require.Error(t, err)
	}

	originalMkdir := makeEditDirectory
	originalWrite := writeEditFile
	t.Cleanup(func() {
		makeEditDirectory = originalMkdir
		writeEditFile = originalWrite
	})

	makeEditDirectory = func(string, os.FileMode) error { return errors.New("mkdir failed") }
	_, _, err = applyAddOp(ctx, patch.Op{Kind: patch.Add, Path: "add.txt", AddLines: []string{"x"}})
	require.ErrorContains(t, err, "mkdir failed")

	makeEditDirectory = originalMkdir
	writeEditFile = func(string, []byte, os.FileMode) error { return errors.New("write failed") }
	_, _, err = applyAddOp(ctx, patch.Op{Kind: patch.Add, Path: "add.txt", AddLines: []string{"x"}})
	require.ErrorContains(t, err, "write failed")
	writeEditFile = originalWrite

	_, _, err = applyDeleteOp(ctx, patch.Op{Kind: patch.Delete, Path: "missing.txt"})
	require.ErrorContains(t, err, "file not found")

	deletePath := filepath.Join(tmpDir, "delete.txt")
	require.NoError(t, os.WriteFile(deletePath, []byte("x"), 0o600))
	restoreFS := util.SetFileSystem(removeErrorFileSystem{})
	_, _, err = applyDeleteOp(ctx, patch.Op{Kind: patch.Delete, Path: "delete.txt"})
	restoreFS()
	require.ErrorContains(t, err, "remove failed")

	ctx.ReadFiles["missing-update.txt"] = true
	_, _, err = applyUpdateOp(ctx, patch.Op{Kind: patch.Update, Path: "missing-update.txt"})
	require.ErrorContains(t, err, "file not found")

	updatePath := filepath.Join(tmpDir, "update-errors.txt")
	require.NoError(t, os.WriteFile(updatePath, []byte("before"), 0o600))
	ctx.ReadFiles["update-errors.txt"] = true
	_, _, err = applyUpdateOp(ctx, patch.Op{Kind: patch.Update, Path: "update-errors.txt", Hunks: []patch.Hunk{{Lines: []patch.Line{{Kind: '-', Text: "missing"}}}}})
	require.ErrorContains(t, err, "could not locate context")

	validHunks := []patch.Hunk{{Lines: []patch.Line{{Kind: '-', Text: "before"}, {Kind: '+', Text: "after"}}}}
	_, _, err = applyUpdateOp(ctx, patch.Op{Kind: patch.Update, Path: "update-errors.txt", MoveTo: "../outside.txt", Hunks: validHunks})
	require.Error(t, err)

	makeEditDirectory = func(string, os.FileMode) error { return errors.New("mkdir failed") }
	_, _, err = applyUpdateOp(ctx, patch.Op{Kind: patch.Update, Path: "update-errors.txt", Hunks: validHunks})
	require.ErrorContains(t, err, "mkdir failed")
	makeEditDirectory = originalMkdir

	writeEditFile = func(string, []byte, os.FileMode) error { return errors.New("write failed") }
	_, _, err = applyUpdateOp(ctx, patch.Op{Kind: patch.Update, Path: "update-errors.txt", Hunks: validHunks})
	require.ErrorContains(t, err, "write failed")
	writeEditFile = originalWrite

	restoreFS = util.SetFileSystem(removeErrorFileSystem{})
	_, _, err = applyUpdateOp(ctx, patch.Op{Kind: patch.Update, Path: "update-errors.txt", MoveTo: "moved.txt", Hunks: validHunks})
	restoreFS()
	require.ErrorContains(t, err, "remove failed")
}
