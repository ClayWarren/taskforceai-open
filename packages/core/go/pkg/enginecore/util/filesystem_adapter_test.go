package util

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport"
)

type testOSFileSystem = testsupport.OSFileSystem

func TestMain(m *testing.M) {
	restore := SetFileSystem(testOSFileSystem{})
	code := m.Run()
	restore()
	os.Exit(code)
}

func TestReadFileLimitReportsTruncation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "limited.txt")
	if err := os.WriteFile(path, []byte("abcdef"), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
	}

	data, truncated, err := (testOSFileSystem{}).ReadFileLimit(path, 3)
	if err != nil {
		t.Fatalf("ReadFileLimit: %v", err)
	}
	if string(data) != "abc" || !truncated {
		t.Fatalf("ReadFileLimit = %q, %v; want %q, true", data, truncated, "abc")
	}

	data, truncated, err = (testOSFileSystem{}).ReadFileLimit(path, 6)
	if err != nil {
		t.Fatalf("ReadFileLimit exact: %v", err)
	}
	if string(data) != "abcdef" || truncated {
		t.Fatalf("ReadFileLimit exact = %q, %v; want %q, false", data, truncated, "abcdef")
	}
}

func TestUnavailableFileSystemReturnsExplicitErrors(t *testing.T) {
	adapter := unavailableFileSystem{}
	_, err := adapter.ReadFile("missing")
	assertUnavailable(t, err)
	_, _, err = adapter.ReadFileLimit("missing", 1)
	assertUnavailable(t, err)
	_, err = adapter.ReadDir("missing")
	assertUnavailable(t, err)
	_, err = adapter.ReadFileWithin("missing", "file")
	assertUnavailable(t, err)
	_, err = adapter.Stat("missing")
	assertUnavailable(t, err)
	_, err = adapter.Lstat("missing")
	assertUnavailable(t, err)
	assertUnavailable(t, adapter.MkdirAll("missing", 0o700))
	assertUnavailable(t, adapter.WriteFile("missing", nil, 0o600))
	assertUnavailable(t, adapter.Rename("old", "new"))
	assertUnavailable(t, adapter.Remove("missing"))
	assertUnavailable(t, adapter.WalkDir("missing", func(string, fs.DirEntry, error) error { return nil }))
	_, err = adapter.Abs("missing")
	assertUnavailable(t, err)
	_, err = adapter.EvalSymlinks("missing")
	assertUnavailable(t, err)
	_, err = adapter.Rel("base", "target")
	assertUnavailable(t, err)

	restore := SetFileSystem(nil)
	assertUnavailable(t, func() error { _, err := CurrentFileSystem().ReadFile("missing"); return err }())
	restore()
}

func assertUnavailable(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrFileSystemUnavailable) {
		t.Fatalf("error = %v; want %v", err, ErrFileSystemUnavailable)
	}
}
