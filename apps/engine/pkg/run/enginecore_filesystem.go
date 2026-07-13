package run

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// enginecoreOSFileSystem is the host adapter for core filesystem ports.
type enginecoreOSFileSystem struct{}

func (enginecoreOSFileSystem) ReadFile(path string) ([]byte, error) {
	return os.ReadFile(path) // #nosec G304 -- core validates workspace and external-directory policy before access.
}

func (enginecoreOSFileSystem) ReadFileLimit(path string, limit int64) ([]byte, bool, error) {
	file, err := os.Open(path) // #nosec G304 -- core validates workspace and external-directory policy before access.
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

func (enginecoreOSFileSystem) ReadDir(path string) ([]fs.DirEntry, error) {
	return os.ReadDir(path) // #nosec G304 -- core validates workspace and external-directory policy before access.
}

func (enginecoreOSFileSystem) ReadFileWithin(root, relativePath string) ([]byte, error) {
	rootHandle, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer rootHandle.Close()
	return rootHandle.ReadFile(relativePath)
}

func (enginecoreOSFileSystem) Stat(path string) (fs.FileInfo, error)  { return os.Stat(path) }
func (enginecoreOSFileSystem) Lstat(path string) (fs.FileInfo, error) { return os.Lstat(path) }
func (enginecoreOSFileSystem) MkdirAll(path string, mode fs.FileMode) error {
	return os.MkdirAll(path, mode)
}
func (enginecoreOSFileSystem) WriteFile(path string, data []byte, mode fs.FileMode) error {
	return os.WriteFile(path, data, mode) // #nosec G304 -- core validates workspace and external-directory policy before access.
}
func (enginecoreOSFileSystem) Rename(oldPath, newPath string) error {
	return os.Rename(oldPath, newPath)
}
func (enginecoreOSFileSystem) Remove(path string) error { return os.Remove(path) }
func (enginecoreOSFileSystem) WalkDir(root string, visit fs.WalkDirFunc) error {
	return filepath.WalkDir(root, visit)
}
func (enginecoreOSFileSystem) Abs(path string) (string, error) { return filepath.Abs(path) }
func (enginecoreOSFileSystem) EvalSymlinks(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}
func (enginecoreOSFileSystem) Rel(base, target string) (string, error) {
	return filepath.Rel(base, target)
}
