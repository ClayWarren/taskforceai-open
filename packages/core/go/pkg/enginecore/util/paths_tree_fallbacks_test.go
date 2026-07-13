package util

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type utilEdgeFileInfo struct {
	name string
	dir  bool
}

func (u utilEdgeFileInfo) Name() string       { return u.name }
func (u utilEdgeFileInfo) Size() int64        { return 1 }
func (u utilEdgeFileInfo) Mode() fs.FileMode  { return 0 }
func (u utilEdgeFileInfo) ModTime() time.Time { return time.Unix(1, 0) }
func (u utilEdgeFileInfo) IsDir() bool        { return u.dir }
func (u utilEdgeFileInfo) Sys() any           { return nil }

type utilEdgeDirEntry struct {
	name string
	dir  bool
}

func (u utilEdgeDirEntry) Name() string      { return u.name }
func (u utilEdgeDirEntry) IsDir() bool       { return u.dir }
func (u utilEdgeDirEntry) Type() fs.FileMode { return 0 }
func (u utilEdgeDirEntry) Info() (fs.FileInfo, error) {
	return utilEdgeFileInfo(u), nil
}

func TestGitIgnoreAdditionalEdges(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("# comment\n/\n!\n"), 0o600))
	assert.Nil(t, LoadGitIgnore(dir))

	assert.True(t, (*GitIgnore)(nil).Apply(true, "file.txt", false))
	assert.False(t, (&GitIgnore{}).Apply(false, "", false))
	assert.True(t, matchAnySegment("b/c.txt", "a/b/c.txt"))
}

func TestUtilPathHookedFailureEdges(t *testing.T) {
	previousAbs := absUtilPath
	previousEval := evalUtilSymlinks
	previousLstat := lstatUtilPath
	previousRel := relUtilPath
	t.Cleanup(func() {
		absUtilPath = previousAbs
		evalUtilSymlinks = previousEval
		lstatUtilPath = previousLstat
		relUtilPath = previousRel
	})

	absUtilPath = func(string) (string, error) {
		return "", errors.New("abs failed")
	}
	_, err := resolvePath("x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "abs failed")
	absUtilPath = previousAbs

	evalUtilSymlinks = func(string) (string, error) {
		return "", errors.New("eval failed")
	}
	_, err = resolvePath("x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "eval failed")

	evalUtilSymlinks = func(string) (string, error) {
		return "", fs.ErrNotExist
	}
	lstatUtilPath = func(string) (os.FileInfo, error) {
		return nil, fs.ErrNotExist
	}
	_, err = resolvePath(string(os.PathSeparator))
	require.ErrorIs(t, err, fs.ErrNotExist)

	evalCalls := 0
	evalUtilSymlinks = func(string) (string, error) {
		evalCalls++
		if evalCalls == 1 {
			return "", fs.ErrNotExist
		}
		return "", errors.New("eval current failed")
	}
	lstatUtilPath = func(path string) (os.FileInfo, error) {
		if filepath.Base(path) == "missing-child" {
			return nil, fs.ErrNotExist
		}
		return utilEdgeFileInfo{name: filepath.Base(path), dir: true}, nil
	}
	_, err = resolvePath(filepath.Join(os.TempDir(), "missing-child"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "eval current failed")

	evalUtilSymlinks = func(string) (string, error) {
		return "", errors.New("root failed")
	}
	assert.False(t, containsPath(os.TempDir(), filepath.Join(os.TempDir(), "file.txt")))

	evalUtilSymlinks = func(path string) (string, error) {
		if filepath.Base(path) == "target.txt" {
			return "", errors.New("target failed")
		}
		return path, nil
	}
	assert.False(t, containsPath(os.TempDir(), filepath.Join(os.TempDir(), "target.txt")))

	evalUtilSymlinks = func(path string) (string, error) {
		return path, nil
	}
	relUtilPath = func(string, string) (string, error) {
		return "", errors.New("rel failed")
	}
	assert.False(t, containsPath(os.TempDir(), filepath.Join(os.TempDir(), "file.txt")))
	relUtilPath = previousRel

	root := t.TempDir()
	assert.False(t, containsPath(root, filepath.Dir(root)))
}

func TestTreeHookedEdges(t *testing.T) {
	previousWalk := walkTreeDir
	previousRel := relTreePath
	t.Cleanup(func() {
		walkTreeDir = previousWalk
		relTreePath = previousRel
	})

	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "visible.txt"), []byte("data"), 0o600))
	res, err := Tree(dir, 0)
	require.NoError(t, err)
	assert.Contains(t, res, "visible.txt")

	walkTreeDir = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(root, "bad.txt"), utilEdgeDirEntry{name: "bad.txt"}, errors.New("walk failed"))
	}
	_, err = Tree(dir, 10)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "walk failed")

	walkTreeDir = func(root string, fn fs.WalkDirFunc) error {
		err := fn(filepath.Join(root, "node_modules"), utilEdgeDirEntry{name: "node_modules", dir: true}, nil)
		if errors.Is(err, filepath.SkipDir) {
			return nil
		}
		return err
	}
	_, err = Tree(dir, 10)
	require.NoError(t, err)

	walkTreeDir = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(root, ".taskforceai", "state.json"), utilEdgeDirEntry{name: "state.json"}, nil)
	}
	_, err = Tree(dir, 10)
	require.NoError(t, err)

	walkTreeDir = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(filepath.Dir(root), "outside.txt"), utilEdgeDirEntry{name: "outside.txt"}, nil)
	}
	relTreePath = func(string, string) (string, error) {
		return "", errors.New("rel failed")
	}
	_, err = Tree(dir, 10)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rel failed")

	_, err = treeRelativePath("/root", "/root/", "/other")
	require.Error(t, err)
	relTreePath = previousRel
	rel, err := treeRelativePath("/root", "/root/", "/other")
	require.NoError(t, err)
	assert.Equal(t, "../other", rel)

	parent := &treeNode{children: []*treeNode{{name: "existing"}}}
	assert.Equal(t, "existing", addChild(parent, "existing").name)

	sortTree(parent)
	sortTree(parent)

	mixed := &treeNode{children: []*treeNode{{name: "file"}, {name: "dir", children: []*treeNode{{name: "child"}}}}}
	sortTree(mixed)
	assert.Equal(t, "dir", mixed.children[0].name)

	sourceRoot := &treeNode{name: "root"}
	target := &treeNode{name: "target", parent: sourceRoot}
	assert.Nil(t, findCopiedPath(&treeNode{}, sourceRoot, target))
}

func TestRuntimeDirectoryFallback(t *testing.T) {
	restore := SetRuntimeContextSource(RuntimeContextSourceFunc(func() RuntimeContext {
		return RuntimeContext{}
	}))
	t.Cleanup(restore)
	assert.Equal(t, ".", Directory())
}
