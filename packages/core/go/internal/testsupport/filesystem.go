// Package testsupport contains outer adapters used only by core tests.
package testsupport

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

type OSFileSystem struct{}

func (OSFileSystem) ReadFile(path string) ([]byte, error) { return os.ReadFile(path) }
func (OSFileSystem) ReadFileLimit(path string, limit int64) ([]byte, bool, error) {
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
func (OSFileSystem) ReadDir(path string) ([]fs.DirEntry, error) { return os.ReadDir(path) }
func (OSFileSystem) ReadFileWithin(root, relativePath string) ([]byte, error) {
	handle, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	return handle.ReadFile(relativePath)
}
func (OSFileSystem) Stat(path string) (fs.FileInfo, error)  { return os.Stat(path) }
func (OSFileSystem) Lstat(path string) (fs.FileInfo, error) { return os.Lstat(path) }
func (OSFileSystem) MkdirAll(path string, mode fs.FileMode) error {
	return os.MkdirAll(path, mode)
}
func (OSFileSystem) WriteFile(path string, data []byte, mode fs.FileMode) error {
	return os.WriteFile(path, data, mode)
}
func (OSFileSystem) Rename(oldPath, newPath string) error { return os.Rename(oldPath, newPath) }
func (OSFileSystem) Remove(path string) error             { return os.Remove(path) }
func (OSFileSystem) WalkDir(root string, visit fs.WalkDirFunc) error {
	return filepath.WalkDir(root, visit)
}
func (OSFileSystem) Abs(path string) (string, error) { return filepath.Abs(path) }
func (OSFileSystem) EvalSymlinks(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}
func (OSFileSystem) Rel(base, target string) (string, error) {
	return filepath.Rel(base, target)
}
