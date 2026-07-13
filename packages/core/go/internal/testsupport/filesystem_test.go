package testsupport

import (
	"io/fs"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOSFileSystemOperations(t *testing.T) {
	adapter := OSFileSystem{}
	root := t.TempDir()
	dir := filepath.Join(root, "nested")
	require.NoError(t, adapter.MkdirAll(dir, 0o700))
	path := filepath.Join(dir, "file.txt")
	require.NoError(t, adapter.WriteFile(path, []byte("abcdef"), 0o600))

	data, err := adapter.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, "abcdef", string(data))
	_, _, err = adapter.ReadFileLimit(filepath.Join(root, "missing"), 3)
	require.Error(t, err)
	_, _, err = adapter.ReadFileLimit(root, 3)
	require.Error(t, err)
	data, truncated, err := adapter.ReadFileLimit(path, 3)
	require.NoError(t, err)
	assert.Equal(t, "abc", string(data))
	assert.True(t, truncated)
	data, truncated, err = adapter.ReadFileLimit(path, 6)
	require.NoError(t, err)
	assert.Equal(t, "abcdef", string(data))
	assert.False(t, truncated)

	entries, err := adapter.ReadDir(dir)
	require.NoError(t, err)
	assert.Len(t, entries, 1)
	data, err = adapter.ReadFileWithin(root, "nested/file.txt")
	require.NoError(t, err)
	assert.Equal(t, "abcdef", string(data))
	_, err = adapter.ReadFileWithin(filepath.Join(root, "missing"), "file.txt")
	require.Error(t, err)
	_, err = adapter.Stat(path)
	require.NoError(t, err)
	_, err = adapter.Lstat(path)
	require.NoError(t, err)

	renamed := filepath.Join(dir, "renamed.txt")
	require.NoError(t, adapter.Rename(path, renamed))
	visited := 0
	require.NoError(t, adapter.WalkDir(root, func(string, fs.DirEntry, error) error {
		visited++
		return nil
	}))
	assert.Positive(t, visited)
	abs, err := adapter.Abs(root)
	require.NoError(t, err)
	assert.True(t, filepath.IsAbs(abs))
	evaluated, err := adapter.EvalSymlinks(root)
	require.NoError(t, err)
	assert.NotEmpty(t, evaluated)
	relative, err := adapter.Rel(root, renamed)
	require.NoError(t, err)
	assert.Equal(t, filepath.Join("nested", "renamed.txt"), relative)
	require.NoError(t, adapter.Remove(renamed))
	_, err = adapter.ReadFile(renamed)
	assert.ErrorIs(t, err, fs.ErrNotExist)
}
