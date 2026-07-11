package tools

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/util"
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
	restore := util.SetFileSystem(testOSFileSystem{})
	code := m.Run()
	restore()
	os.Exit(code)
}

func mustReadTestFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path) // #nosec G304 -- tests read files they create under t.TempDir or controlled temp paths.
	if err != nil {
		t.Fatalf("read test file %q: %v", path, err)
	}
	return data
}
