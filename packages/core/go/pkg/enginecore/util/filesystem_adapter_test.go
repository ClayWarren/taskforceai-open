package util

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

type testOSFileSystem struct{}

func (testOSFileSystem) ReadFile(path string) ([]byte, error) { return os.ReadFile(path) }
func (testOSFileSystem) ReadFileLimit(path string, limit int64) ([]byte, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, false, err
	}
	if int64(len(data)) > limit {
		return data[:limit], true, nil
	}
	return data, false, nil
}
func (testOSFileSystem) ReadDir(path string) ([]fs.DirEntry, error) { return os.ReadDir(path) }
func (testOSFileSystem) ReadFileWithin(root, relativePath string) ([]byte, error) {
	handle, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	return handle.ReadFile(relativePath)
}
func (testOSFileSystem) Stat(path string) (fs.FileInfo, error)  { return os.Stat(path) }
func (testOSFileSystem) Lstat(path string) (fs.FileInfo, error) { return os.Lstat(path) }
func (testOSFileSystem) MkdirAll(path string, mode fs.FileMode) error {
	return os.MkdirAll(path, mode)
}
func (testOSFileSystem) WriteFile(path string, data []byte, mode fs.FileMode) error {
	return os.WriteFile(path, data, mode)
}
func (testOSFileSystem) Rename(oldPath, newPath string) error { return os.Rename(oldPath, newPath) }
func (testOSFileSystem) Remove(path string) error             { return os.Remove(path) }
func (testOSFileSystem) WalkDir(root string, visit fs.WalkDirFunc) error {
	return filepath.WalkDir(root, visit)
}
func (testOSFileSystem) Abs(path string) (string, error) { return filepath.Abs(path) }
func (testOSFileSystem) EvalSymlinks(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}
func (testOSFileSystem) Rel(base, target string) (string, error) {
	return filepath.Rel(base, target)
}

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

	fileSystemMu.Lock()
	previous := fileSystem
	fileSystem = nil
	fileSystemMu.Unlock()
	assertUnavailable(t, func() error { _, err := CurrentFileSystem().ReadFile("missing"); return err }())
	fileSystemMu.Lock()
	fileSystem = previous
	fileSystemMu.Unlock()
}

func assertUnavailable(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrFileSystemUnavailable) {
		t.Fatalf("error = %v; want %v", err, ErrFileSystemUnavailable)
	}
}
