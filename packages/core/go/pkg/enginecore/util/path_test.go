package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestContainsPath_BlocksSymlinkEscapes(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	linked := filepath.Join(root, "outside-link")
	if err := os.Symlink(outside, linked); err != nil {
		t.Fatalf("failed creating symlink: %v", err)
	}
	if containsPath(root, filepath.Join(linked, "file.txt")) {
		t.Fatal("expected symlink escape to be rejected")
	}
}

func TestContainsPath_AllowsNestedPath(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "sub", "file.txt")
	if !containsPath(root, nested) {
		t.Fatal("expected nested path to be allowed")
	}
	if !containsPath(root, "sub/file.txt") {
		t.Fatal("expected relative nested path to be allowed")
	}
	if !containsPath(root, root) {
		t.Fatal("expected root path to be allowed")
	}
	if containsPath("", nested) {
		t.Fatal("empty root should be rejected")
	}
	if containsPath(root, "") {
		t.Fatal("empty target should be rejected")
	}
	if containsPath(filepath.Join(root, "missing-root"), nested) {
		t.Fatal("missing root should be rejected")
	}
}

func TestResolvePathWithMissingSuffixThroughSymlink(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "real")
	if err := os.Mkdir(real, 0750); err != nil {
		t.Fatalf("mkdir real: %v", err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	resolved, err := resolvePath(filepath.Join(link, "future", "file.txt"))
	if err != nil {
		t.Fatalf("resolve missing suffix: %v", err)
	}
	realResolved, err := filepath.EvalSymlinks(real)
	if err != nil {
		t.Fatalf("resolve real dir: %v", err)
	}
	want := filepath.Join(realResolved, "future", "file.txt")
	if resolved != want {
		t.Fatalf("resolved path = %q; want %q", resolved, want)
	}
}
