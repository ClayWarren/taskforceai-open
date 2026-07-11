package util

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTree(t *testing.T) {
	tmpDir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(tmpDir, "a", "b"), 0750)
	_ = os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte("data"), 0600)
	_ = os.WriteFile(filepath.Join(tmpDir, "a", "file2.txt"), []byte("data"), 0600)

	t.Run("basic tree", func(t *testing.T) {
		res, err := Tree(tmpDir, 10)
		require.NoError(t, err)
		assert.Contains(t, res, "file1.txt")
		assert.Contains(t, res, "a/")
		assert.Contains(t, res, "file2.txt")
	})

	t.Run("empty cwd", func(t *testing.T) {
		res, err := Tree("", 10)
		require.NoError(t, err)
		assert.Empty(t, res)
	})
}

func TestTreeAppliesLimitAndGitignore(t *testing.T) {
	tmpDir := t.TempDir()
	assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("ignored.txt\nignored-dir/\n"), 0600))
	assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "visible.txt"), []byte("data"), 0600))
	assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "ignored.txt"), []byte("data"), 0600))
	assert.NoError(t, os.MkdirAll(filepath.Join(tmpDir, "ignored-dir"), 0750))
	assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "ignored-dir", "file.txt"), []byte("data"), 0600))
	for i := range 5 {
		require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "file"+itoa(i)+".txt"), []byte("data"), 0600))
	}

	res, err := Tree(tmpDir, 2)
	require.NoError(t, err)
	assert.Contains(t, res, "truncated")
	assert.NotContains(t, res, "ignored.txt")
	assert.NotContains(t, res, "ignored-dir")
}

func TestTreePreservesBreadthFirstTruncationShape(t *testing.T) {
	tmpDir := t.TempDir()
	for _, rel := range []string{
		"a/a1.txt",
		"a/a2.txt",
		"b/b1.txt",
		"b/b2.txt",
		"c/c1.txt",
	} {
		path := filepath.Join(tmpDir, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0750))
		require.NoError(t, os.WriteFile(path, []byte("data"), 0600))
	}

	res, err := Tree(tmpDir, 3)
	require.NoError(t, err)
	assert.Equal(t, strings.Join([]string{
		"a/",
		"\t[2 truncated]",
		"b/",
		"\t[2 truncated]",
		"c/",
		"\t[1 truncated]",
	}, "\n"), res)
}

func BenchmarkTreeLargeWorktree(b *testing.B) {
	root := b.TempDir()
	for dir := range 80 {
		dirPath := filepath.Join(root, "pkg", "module-"+strconv.Itoa(dir), "internal")
		require.NoError(b, os.MkdirAll(dirPath, 0750))
		for file := range 40 {
			require.NoError(b, os.WriteFile(filepath.Join(dirPath, "file"+strconv.Itoa(file)+".go"), []byte("package internal\n"), 0600))
		}
	}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		res, err := Tree(root, 50)
		if err != nil {
			b.Fatalf("Tree returned error: %v", err)
		}
		if res == "" {
			b.Fatal("expected tree output")
		}
	}
}
