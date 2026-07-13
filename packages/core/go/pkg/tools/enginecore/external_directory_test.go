package tools

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type denyPermission struct{}

func (denyPermission) Ask(_ protocol.PermissionRequest) error {
	return errPermissionDenied{}
}

type errPermissionDenied struct{}

func (errPermissionDenied) Error() string {
	return "denied"
}

func TestExternalDirectoryBypassDoesNotSkipPrompt(t *testing.T) {
	ctx := protocol.ToolContext{
		Cwd:        "/tmp",
		ReadFiles:  map[string]bool{},
		Permission: denyPermission{},
	}
	err := assertExternalDirectory(ctx, "/outside/path/file.txt", &externalDirectoryOptions{Bypass: true})
	if err == nil || err.Error() != "denied" {
		t.Fatalf("expected denied error even when bypass=true, got %v", err)
	}
}

func TestExternalDirectory_KindDirectory(t *testing.T) {
	ctx := protocol.ToolContext{
		Cwd:        "/tmp",
		Permission: denyPermission{},
	}
	err := assertExternalDirectory(ctx, "/outside/dir", &externalDirectoryOptions{Kind: kindDirectory})
	if err == nil || err.Error() != "denied" {
		t.Errorf("expected denied error for directory, got %v", err)
	}
}

func TestExternalDirectory_NoPermissionChecker(t *testing.T) {
	ctx := protocol.ToolContext{Cwd: "/tmp"}
	err := assertExternalDirectory(ctx, "/outside/path", nil)
	if !errors.Is(err, errExternalDirectoryPermissionCheckerRequired) {
		t.Errorf("expected fail-closed error when no permission checker, got %v", err)
	}
}

func TestExternalDirectory_EmptyTarget(t *testing.T) {
	_ = assertExternalDirectory(protocol.ToolContext{}, "", nil)
}

func TestExternalDirectory_PathTraversalRequiresPermissionChecker(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "nested")
	target := filepath.Join(cwd, "..", "..", "escape.txt")
	ctx := protocol.ToolContext{Cwd: cwd}

	err := assertExternalDirectory(ctx, target, nil)
	if !errors.Is(err, errExternalDirectoryPermissionCheckerRequired) {
		t.Fatalf("expected fail-closed error for traversal target, got %v", err)
	}
}

func TestExternalDirectory_InsideCwdDoesNotAsk(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "file.txt")
	ctx := protocol.ToolContext{
		Cwd:        root,
		Permission: denyPermission{},
	}

	err := assertExternalDirectory(ctx, target, nil)
	if err != nil {
		t.Fatalf("expected in-root target to bypass external-directory ask, got %v", err)
	}
}

type captureExternalPermission struct {
	calls int
	last  protocol.PermissionRequest
	err   error
}

func (c *captureExternalPermission) Ask(req protocol.PermissionRequest) error {
	c.calls++
	c.last = req
	return c.err
}

func TestExternalDirectory_RequestMetadataForFileTarget(t *testing.T) {
	root := t.TempDir()
	externalRoot := t.TempDir()
	target := filepath.Join(externalRoot, "nested", "file.txt")
	capture := &captureExternalPermission{}

	err := assertExternalDirectory(protocol.ToolContext{
		Cwd:        root,
		Permission: capture,
	}, target, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if capture.calls != 1 {
		t.Fatalf("expected one permission request, got %d", capture.calls)
	}

	parentDir := filepath.Dir(target)
	glob := filepath.Join(parentDir, "*")
	if capture.last.Permission != "external_directory" {
		t.Fatalf("unexpected permission type: %s", capture.last.Permission)
	}
	if !reflect.DeepEqual(capture.last.Patterns, []string{glob}) {
		t.Fatalf("unexpected patterns: %#v", capture.last.Patterns)
	}
	if !reflect.DeepEqual(capture.last.Always, []string{glob}) {
		t.Fatalf("unexpected always patterns: %#v", capture.last.Always)
	}
	if got := capture.last.Metadata["filePath"]; got != target {
		t.Fatalf("unexpected metadata filePath: %#v", got)
	}
	if got := capture.last.Metadata["filepath"]; got != target {
		t.Fatalf("unexpected metadata filepath: %#v", got)
	}
	if got := capture.last.Metadata["parentDir"]; got != parentDir {
		t.Fatalf("unexpected metadata parentDir: %#v", got)
	}
}

func TestExternalDirectory_RequestMetadataForDirectoryTarget(t *testing.T) {
	root := t.TempDir()
	externalTarget := filepath.Join(t.TempDir(), "subdir")
	capture := &captureExternalPermission{}

	err := assertExternalDirectory(protocol.ToolContext{
		Cwd:        root,
		Permission: capture,
	}, externalTarget, &externalDirectoryOptions{Kind: kindDirectory})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if capture.calls != 1 {
		t.Fatalf("expected one permission request, got %d", capture.calls)
	}
	glob := filepath.Join(externalTarget, "*")
	if !reflect.DeepEqual(capture.last.Patterns, []string{glob}) {
		t.Fatalf("unexpected patterns for directory: %#v", capture.last.Patterns)
	}
	if got := capture.last.Metadata["parentDir"]; got != externalTarget {
		t.Fatalf("expected parentDir to equal directory target, got %#v", got)
	}
}

func TestExternalDirectory_UsesWorktreeWhenCwdMissing(t *testing.T) {
	root := t.TempDir()
	restore := util.SetRuntimeContextSource(util.RuntimeContextSourceFunc(func() util.RuntimeContext {
		return util.RuntimeContext{RootDir: t.TempDir(), WorktreeDir: root}
	}))
	t.Cleanup(restore)
	target := filepath.Join(root, "in-worktree.txt")
	ctx := protocol.ToolContext{
		Permission: denyPermission{},
	}

	err := assertExternalDirectory(ctx, target, nil)
	if err != nil {
		t.Fatalf("expected worktree-relative target to bypass ask, got %v", err)
	}
}

func TestResolvePath(t *testing.T) {
	t.Run("nonexistent leaf under existing directory preserves suffix", func(t *testing.T) {
		root := t.TempDir()
		target := filepath.Join(root, "missing", "file.txt")
		resolved, err := util.ResolvePath(target)
		if err != nil {
			t.Fatalf("resolvePath returned error: %v", err)
		}
		rootResolved, err := util.ResolvePath(root)
		if err != nil {
			t.Fatalf("resolvePath(root) returned error: %v", err)
		}
		want := filepath.Join(rootResolved, "missing", "file.txt")
		if resolved != filepath.Clean(want) {
			t.Fatalf("unexpected resolved path: got %q, want %q", resolved, want)
		}
	})

	t.Run("symlink parent is resolved", func(t *testing.T) {
		root := t.TempDir()
		realDir := filepath.Join(root, "real")
		if err := os.MkdirAll(realDir, 0o750); err != nil {
			t.Fatalf("mkdir realDir: %v", err)
		}
		linkDir := filepath.Join(root, "link")
		if err := os.Symlink(realDir, linkDir); err != nil {
			t.Fatalf("symlink: %v", err)
		}

		resolved, err := util.ResolvePath(filepath.Join(linkDir, "missing.txt"))
		if err != nil {
			t.Fatalf("resolvePath returned error: %v", err)
		}
		realResolved, err := util.ResolvePath(realDir)
		if err != nil {
			t.Fatalf("resolvePath(realDir) returned error: %v", err)
		}
		want := filepath.Join(realResolved, "missing.txt")
		if resolved != filepath.Clean(want) {
			t.Fatalf("unexpected resolved path: got %q, want %q", resolved, want)
		}
	})
}

func TestContainsPath(t *testing.T) {
	root := t.TempDir()
	if util.ContainsPath("", "x") {
		t.Fatal("expected empty root to return false")
	}
	if util.ContainsPath(root, "") {
		t.Fatal("expected empty target to return false")
	}
	if !util.ContainsPath(root, root) {
		t.Fatal("expected root to contain itself")
	}
	if !util.ContainsPath(root, filepath.Join("nested", "file.txt")) {
		t.Fatal("expected relative target in root to be contained")
	}
	if util.ContainsPath(root, filepath.Join("..", "escape.txt")) {
		t.Fatal("expected parent traversal target to be outside root")
	}
}
