package util

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

type failingGitIgnoreFileSystem struct{ testOSFileSystem }

func (failingGitIgnoreFileSystem) ReadFile(string) ([]byte, error) {
	return nil, fs.ErrPermission
}

func TestGitIgnoreBasic(t *testing.T) {
	dir := t.TempDir()
	data := []byte("node_modules/\n*.log\n!important.log\n/onlyroot.txt\n")
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), data, 0o600); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}
	ignore := NewGitIgnoreChain(dir)

	cases := []struct {
		rel   string
		isDir bool
		want  bool
	}{
		{"node_modules", true, true},
		{"node_modules", false, false},
		{"app/error.log", false, true},
		{"app/important.log", false, false},
		{"onlyroot.txt", false, true},
		{"nested/onlyroot.txt", false, false},
	}

	for _, c := range cases {
		if got := ignore.Ignore(c.rel, c.isDir); got != c.want {
			t.Fatalf("Ignore(%q, %v) = %v; want %v", c.rel, c.isDir, got, c.want)
		}
	}
}

func TestGitIgnoreNested(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("root.log\n"), 0o600); err != nil {
		t.Fatalf("write root .gitignore: %v", err)
	}
	sub := filepath.Join(dir, "sub")
	if err := os.MkdirAll(sub, 0o750); err != nil {
		t.Fatalf("mkdir sub: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sub, ".gitignore"), []byte("child.log\n"), 0o600); err != nil {
		t.Fatalf("write sub .gitignore: %v", err)
	}

	ignore := NewGitIgnoreChain(dir)
	if ignore.Ignore("root.log", false) != true {
		t.Fatalf("expected root.log to be ignored")
	}
	if ignore.Ignore("sub/child.log", false) != true {
		t.Fatalf("expected sub/child.log to be ignored")
	}
	if ignore.Ignore("sub/root.log", false) != true {
		t.Fatalf("expected sub/root.log to be ignored by root rules")
	}
	if ignore.Ignore("sub/keep.txt", false) != false {
		t.Fatalf("expected sub/keep.txt to be kept")
	}
}

func TestGitIgnoreChainEdgeCases(t *testing.T) {
	if NewGitIgnoreChain("") != nil {
		t.Fatalf("empty root should not create a chain")
	}
	if (*GitIgnoreChain)(nil).Ignore("debug.log", false) {
		t.Fatalf("nil chain should not ignore paths")
	}

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("# comment\n\\#literal\n\\!literal\nbad[pattern\n"), 0o600); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}
	ignore := NewGitIgnoreChain(dir)
	if !ignore.Ignore("#literal", false) {
		t.Fatalf("escaped hash pattern should be active")
	}
	if !ignore.Ignore("!literal", false) {
		t.Fatalf("escaped bang pattern should be active")
	}
	if ignore.Ignore("anything", false) {
		t.Fatalf("invalid pattern should not match")
	}
	if ignore.Ignore("", false) {
		t.Fatalf("empty path should not be ignored")
	}
}

func TestGitIgnoreDirectIgnoreAndMissingFiles(t *testing.T) {
	if LoadGitIgnore("") != nil {
		t.Fatalf("empty root should not load rules")
	}

	dir := t.TempDir()
	if LoadGitIgnore(dir) != nil {
		t.Fatalf("missing .gitignore should return nil")
	}

	data := []byte("*.tmp\nbuild/\n!/build/keep.tmp\n")
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), data, 0o600); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}

	ignore := LoadGitIgnore(dir)
	if ignore == nil {
		t.Fatalf("expected rules")
	}
	if !ignore.Ignore("notes.tmp", false) {
		t.Fatalf("direct ignore should match file pattern")
	}
	if !ignore.Ignore("build", true) {
		t.Fatalf("direct ignore should match directory pattern")
	}
	if ignore.Ignore("build", false) {
		t.Fatalf("directory-only pattern should not match a file")
	}
	if ignore.Ignore("build/keep.tmp", false) {
		t.Fatalf("negated pattern should keep the file")
	}
}

func TestLoadGitIgnorePanicsWhenFileSystemIsUnavailable(t *testing.T) {
	restore := SetFileSystem(nil)
	defer restore()

	defer func() {
		recovered := recover()
		err, ok := recovered.(error)
		if !ok || !errors.Is(err, ErrFileSystemUnavailable) {
			t.Fatalf("panic = %v; want %v", recovered, ErrFileSystemUnavailable)
		}
	}()

	LoadGitIgnore(t.TempDir())
}

func TestLoadGitIgnoreHandlesUnreadableFile(t *testing.T) {
	restore := SetFileSystem(failingGitIgnoreFileSystem{})
	defer restore()
	if LoadGitIgnore(t.TempDir()) != nil {
		t.Fatal("unreadable gitignore should disable ignore rules")
	}
}
