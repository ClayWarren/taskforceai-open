package util

import (
	"errors"
	"io/fs"
	"sync"
)

var ErrFileSystemUnavailable = errors.New("enginecore filesystem adapter is not configured")

// FileSystem is the host-filesystem port required by enginecore policy.
// Concrete OS access is supplied by an outer application adapter.
type FileSystem interface {
	ReadFile(string) ([]byte, error)
	ReadFileLimit(string, int64) ([]byte, bool, error)
	ReadDir(string) ([]fs.DirEntry, error)
	ReadFileWithin(string, string) ([]byte, error)
	Stat(string) (fs.FileInfo, error)
	Lstat(string) (fs.FileInfo, error)
	MkdirAll(string, fs.FileMode) error
	WriteFile(string, []byte, fs.FileMode) error
	Rename(string, string) error
	Remove(string) error
	WalkDir(string, fs.WalkDirFunc) error
	Abs(string) (string, error)
	EvalSymlinks(string) (string, error)
	Rel(string, string) (string, error)
}

type unavailableFileSystem struct{}

func (unavailableFileSystem) ReadFile(string) ([]byte, error) { return nil, ErrFileSystemUnavailable }
func (unavailableFileSystem) ReadFileLimit(string, int64) ([]byte, bool, error) {
	return nil, false, ErrFileSystemUnavailable
}
func (unavailableFileSystem) ReadDir(string) ([]fs.DirEntry, error) {
	return nil, ErrFileSystemUnavailable
}
func (unavailableFileSystem) ReadFileWithin(string, string) ([]byte, error) {
	return nil, ErrFileSystemUnavailable
}
func (unavailableFileSystem) Stat(string) (fs.FileInfo, error) {
	return nil, ErrFileSystemUnavailable
}
func (unavailableFileSystem) Lstat(string) (fs.FileInfo, error) {
	return nil, ErrFileSystemUnavailable
}
func (unavailableFileSystem) MkdirAll(string, fs.FileMode) error { return ErrFileSystemUnavailable }
func (unavailableFileSystem) WriteFile(string, []byte, fs.FileMode) error {
	return ErrFileSystemUnavailable
}
func (unavailableFileSystem) Rename(string, string) error { return ErrFileSystemUnavailable }
func (unavailableFileSystem) Remove(string) error         { return ErrFileSystemUnavailable }
func (unavailableFileSystem) WalkDir(string, fs.WalkDirFunc) error {
	return ErrFileSystemUnavailable
}
func (unavailableFileSystem) Abs(string) (string, error) { return "", ErrFileSystemUnavailable }
func (unavailableFileSystem) EvalSymlinks(string) (string, error) {
	return "", ErrFileSystemUnavailable
}
func (unavailableFileSystem) Rel(string, string) (string, error) { return "", ErrFileSystemUnavailable }

var (
	fileSystemMu sync.RWMutex
	fileSystem   FileSystem = unavailableFileSystem{}
)

func SetFileSystem(adapter FileSystem) func() {
	if adapter == nil {
		adapter = unavailableFileSystem{}
	}
	fileSystemMu.Lock()
	previous := fileSystem
	fileSystem = adapter
	fileSystemMu.Unlock()
	return func() {
		fileSystemMu.Lock()
		fileSystem = previous
		fileSystemMu.Unlock()
	}
}

func CurrentFileSystem() FileSystem {
	fileSystemMu.RLock()
	adapter := fileSystem
	fileSystemMu.RUnlock()
	if adapter == nil {
		return unavailableFileSystem{}
	}
	return adapter
}
