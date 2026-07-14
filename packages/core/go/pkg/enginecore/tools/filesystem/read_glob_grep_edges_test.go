package filesystem

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type edgeDirEntry struct {
	name    string
	dir     bool
	infoErr error
}

func (e edgeDirEntry) Name() string      { return e.name }
func (e edgeDirEntry) IsDir() bool       { return e.dir }
func (e edgeDirEntry) Type() fs.FileMode { return 0 }
func (e edgeDirEntry) Info() (fs.FileInfo, error) {
	return edgeFileInfo{name: e.name, dir: e.dir}, e.infoErr
}

type edgeFileInfo struct {
	name string
	dir  bool
}

func (e edgeFileInfo) Name() string       { return e.name }
func (e edgeFileInfo) Size() int64        { return 1 }
func (e edgeFileInfo) Mode() fs.FileMode  { return 0 }
func (e edgeFileInfo) ModTime() time.Time { return time.Unix(100, 0) }
func (e edgeFileInfo) IsDir() bool        { return e.dir }
func (e edgeFileInfo) Sys() any           { return nil }

func TestReadEdgeBranches(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}

	outsideFile := filepath.Join(t.TempDir(), "outside.txt")
	outsideRel, err := filepath.Rel(tmpDir, outsideFile)
	require.NoError(t, err)
	res := ExecuteRead(ctx, map[string]any{"filePath": outsideRel})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "external directory")

	res = ExecuteRead(ctx, map[string]any{"filePath": "/"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "File not found")

	assert.Nil(t, similarFileSuggestions(filepath.Join(tmpDir, "missing-parent", "file.txt")))
	assert.Equal(t, textReadWindow{totalLines: 1}, readTextWindow(nil, 0, 10, 20, 100))
	window := readTextWindow([]byte("first\nsecond"), 0, 10, 100, 3)
	assert.True(t, window.truncatedByBytes)
	assert.Equal(t, 2, utf16Len("😀"))
}

func TestGlobEdgeBranches(t *testing.T) {
	t.Run("collector skips old entries and trims oversized buffers", func(t *testing.T) {
		collector := globFileCollector{}
		newTime := time.Unix(200, 0)
		oldTime := time.Unix(100, 0)
		for i := 0; i < globResultLimit+1; i++ {
			collector.Add(fileEntry{path: "new", mtime: newTime})
		}
		collector.Add(fileEntry{path: "old", mtime: oldTime})
		assert.Equal(t, globResultLimit+2, collector.total)

		large := globFileCollector{}
		for i := 0; i < globResultLimit*4+2; i++ {
			large.Add(fileEntry{path: "file", mtime: time.Unix(int64(i), 0)})
		}
		assert.LessOrEqual(t, len(large.files), globResultLimit+2)
	})

	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}
	outsideDir := t.TempDir()
	outsideRel, err := filepath.Rel(tmpDir, outsideDir)
	require.NoError(t, err)
	res := ExecuteGlob(ctx, map[string]any{"path": outsideRel, "pattern": "*"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "external directory")

	previousWalk := walkGlobDir
	previousRel := relGlobPath
	t.Cleanup(func() {
		walkGlobDir = previousWalk
		relGlobPath = previousRel
	})

	walkGlobDir = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(root, "bad.txt"), edgeDirEntry{name: "bad.txt"}, errors.New("walk failed"))
	}
	res = ExecuteGlob(ctx, map[string]any{"pattern": "*"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "walk failed")

	walkGlobDir = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(root, "bad.txt"), edgeDirEntry{name: "bad.txt", infoErr: errors.New("info failed")}, nil)
	}
	res = ExecuteGlob(ctx, map[string]any{"pattern": "*"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "info failed")

	walkGlobDir = func(root string, fn fs.WalkDirFunc) error {
		err := fn(filepath.Join(root, ".git"), edgeDirEntry{name: ".git", dir: true}, nil)
		if errors.Is(err, filepath.SkipDir) {
			return nil
		}
		return err
	}
	res = ExecuteGlob(ctx, map[string]any{"pattern": "*"})
	assert.Equal(t, "completed", res.Status)

	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("ignored-dir/\n"), 0o600))
	walkGlobDir = func(root string, fn fs.WalkDirFunc) error {
		err := fn(filepath.Join(root, "ignored-dir"), edgeDirEntry{name: "ignored-dir", dir: true}, nil)
		if errors.Is(err, filepath.SkipDir) {
			return nil
		}
		return err
	}
	res = ExecuteGlob(ctx, map[string]any{"pattern": "*"})
	assert.Equal(t, "completed", res.Status)

	relGlobPath = func(string, string) (string, error) { return "", errors.New("rel failed") }
	walkGlobDir = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(root, "file.txt"), edgeDirEntry{name: "file.txt"}, nil)
	}
	res = ExecuteGlob(ctx, map[string]any{"pattern": "*"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "rel failed")
	relGlobPath = previousRel
	walkGlobDir = previousWalk

	require.NoError(t, os.MkdirAll(filepath.Join(tmpDir, "sub"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "sub", "file.txt"), []byte("x"), 0o600))
	res = ExecuteGlob(ctx, map[string]any{"path": "sub", "pattern": "*.txt"})
	assert.Equal(t, "completed", res.Status)
	assert.Equal(t, "sub", res.Title)

	assert.Equal(t, []string{"*.go"}, expandBrace("*.go"))
	assert.Equal(t, []string{"a.txt", "b.txt"}, expandBrace("{a,b}.txt"))
	assert.NotEmpty(t, expandBrace("*.{a,b}"))
}

func TestGrepEdgeBranches(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}

	collector := grepMatchCollector{}
	for i := 0; i < grepResultLimit*4+2; i++ {
		collector.Add("file", int64(i), i+1, []byte("line"))
	}
	assert.LessOrEqual(t, len(collector.matches), grepResultLimit+2)

	previousStat := statGrepPath
	previousCollect := collectGrepMatchesForTool
	previousRel := relGrepPath
	t.Cleanup(func() {
		statGrepPath = previousStat
		collectGrepMatchesForTool = previousCollect
		relGrepPath = previousRel
	})

	statGrepPath = func(string) (os.FileInfo, error) { return nil, errors.New("stat failed") }
	res := ExecuteGrep(ctx, map[string]any{"pattern": "x"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "stat failed")
	statGrepPath = previousStat

	collectGrepMatchesForTool = func(protocol.ToolContext, string, os.FileInfo, grepIncludeMatcher, *regexp.Regexp) ([]grepMatch, bool, error) {
		return nil, false, errors.New("walk failed")
	}
	res = ExecuteGrep(ctx, map[string]any{"pattern": "x"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "walk failed")

	cancelCtx, cancel := context.WithCancel(context.Background())
	collectGrepMatchesForTool = func(protocol.ToolContext, string, os.FileInfo, grepIncludeMatcher, *regexp.Regexp) ([]grepMatch, bool, error) {
		cancel()
		return nil, false, errors.New("walk failed")
	}
	res = ExecuteGrep(protocol.ToolContext{Ctx: cancelCtx, Cwd: tmpDir}, map[string]any{"pattern": "x"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "context canceled")
	collectGrepMatchesForTool = previousCollect

	literal := newGrepMatcher(regexp.MustCompile("literal"))
	assert.True(t, literal([]byte("has literal text")))
	assert.False(t, literal([]byte("missing")))
	regexMatcher := newGrepMatcher(regexp.MustCompile("l.t"))
	assert.True(t, regexMatcher([]byte("lit")))

	canceledCtx, cancelVisit := context.WithCancel(context.Background())
	cancelVisit()
	err := visitGrepPath(protocol.ToolContext{Ctx: canceledCtx}, grepVisitInput{}, "p", edgeDirEntry{name: "file"}, nil)
	require.ErrorContains(t, err, "context canceled")
	err = visitGrepPath(protocol.ToolContext{Ctx: context.Background()}, grepVisitInput{}, "p", edgeDirEntry{name: "file"}, errors.New("visit failed"))
	require.ErrorContains(t, err, "visit failed")

	err = handleGrepDir(nil, tmpDir, filepath.Join(tmpDir, ".git"), edgeDirEntry{name: ".git", dir: true})
	require.ErrorIs(t, err, filepath.SkipDir)

	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("ignored.txt\nignored-dir/\n"), 0o600))
	ignore := mustGitIgnoreChain(tmpDir)
	assert.True(t, shouldSkipGrepFile(ignore, tmpDir, nil, filepath.Join(tmpDir, "ignored.txt")))
	err = handleGrepDir(ignore, tmpDir, filepath.Join(tmpDir, "ignored-dir"), edgeDirEntry{name: "ignored-dir", dir: true})
	require.ErrorIs(t, err, filepath.SkipDir)

	include := newGrepIncludeMatcher("sub/*.go", tmpDir)
	assert.True(t, include(filepath.Join(tmpDir, "sub", "main.go")))
	assert.False(t, include(filepath.Join(tmpDir, "other", "main.go")))

	input := grepVisitInput{rootPath: tmpDir, matches: &grepMatchCollector{}, matcher: func([]byte) bool { return true }}
	relGrepPath = func(string, string) (string, error) { return "", errors.New("rel failed") }
	err = appendFileMatches(input, filepath.Join(tmpDir, "rel.txt"), edgeDirEntry{name: "rel.txt"})
	require.ErrorContains(t, err, "rel failed")
	relGrepPath = previousRel
	err = appendFileMatches(input, filepath.Join(tmpDir, "bad-info.txt"), edgeDirEntry{name: "bad-info.txt", infoErr: errors.New("info failed")})
	require.ErrorContains(t, err, "info failed")
	err = appendFileMatches(input, filepath.Join(tmpDir, "missing.txt"), edgeDirEntry{name: "missing.txt"})
	require.Error(t, err)

	assert.Equal(t, []byte("line"), trimGrepCarriageReturn([]byte("line\r")))
}

func TestScanGrepLinesEdges(t *testing.T) {
	var emptyLines []string
	scanGrepLines(nil, func(lineNum int, line []byte) {
		emptyLines = append(emptyLines, fmt.Sprintf("%d:%s", lineNum, string(line)))
	})
	assert.Equal(t, []string{"1:"}, emptyLines)

	var trailingNewline []string
	scanGrepLines([]byte("first\n"), func(lineNum int, line []byte) {
		trailingNewline = append(trailingNewline, fmt.Sprintf("%d:%s", lineNum, string(line)))
	})
	assert.Equal(t, []string{"1:first", "2:"}, trailingNewline)
}

func mustGitIgnoreChain(root string) *util.GitIgnoreChain {
	return util.NewGitIgnoreChain(root)
}
