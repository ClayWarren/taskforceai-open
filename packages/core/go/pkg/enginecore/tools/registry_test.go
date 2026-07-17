package tools

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockPermission struct {
	asked   bool
	lastReq protocol.PermissionRequest
	err     error
}

func TestExecuteToolInitializesReadState(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.txt")
	require.NoError(t, os.WriteFile(path, []byte("line 1\n"), 0o600))
	result := ExecuteTool(protocol.ToolContext{Ctx: context.Background(), Cwd: dir}, "read", map[string]any{"filePath": "hello.txt"})
	assert.Equal(t, "completed", result.Status)
	assert.Contains(t, result.Output, "line 1")
}

func TestNormalizeCodeSearchArgsWithoutQuery(t *testing.T) {
	args := map[string]any{}
	normalized := normalizeCodeSearchArgs(args)
	assert.Empty(t, normalized)
	assert.NotContains(t, normalized, "pattern")
}

func (m *mockPermission) Ask(req protocol.PermissionRequest) error {
	m.asked = true
	m.lastReq = req
	return m.err
}

func TestAsk(t *testing.T) {
	t.Run("returns nil when no permission checker is configured", func(t *testing.T) {
		err := ask(protocol.ToolContext{}, "read", map[string]any{"filePath": "f.txt"})
		assert.NoError(t, err)
	})

	t.Run("propagates permission checker errors", func(t *testing.T) {
		mp := &mockPermission{err: errors.New("denied")}
		err := ask(protocol.ToolContext{Permission: mp}, "read", map[string]any{"filePath": "f.txt"})
		require.ErrorContains(t, err, "denied")
		assert.True(t, mp.asked)
	})

	testCases := []struct {
		name     string
		metadata map[string]any
		want     []string
	}{
		{
			name:     "file path patterns",
			metadata: map[string]any{"filePath": "src/main.go"},
			want:     []string{"src/main.go"},
		},
		{
			name:     "path patterns",
			metadata: map[string]any{"path": "pkg"},
			want:     []string{"pkg"},
		},
		{
			name:     "regex pattern patterns",
			metadata: map[string]any{"pattern": "needle"},
			want:     []string{"needle"},
		},
		{
			name:     "url includes hostname",
			metadata: map[string]any{"url": "https://example.com/a"},
			want:     []string{"https://example.com/a", "example.com"},
		},
		{
			name:     "invalid url keeps raw value only",
			metadata: map[string]any{"url": "http://%"},
			want:     []string{"http://%"},
		},
		{
			name:     "empty metadata yields empty patterns",
			metadata: map[string]any{},
			want:     nil,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mp := &mockPermission{}
			err := ask(protocol.ToolContext{Permission: mp}, "sample", tc.metadata)
			require.NoError(t, err)
			assert.True(t, mp.asked)
			assert.Equal(t, "sample", mp.lastReq.Permission)
			assert.Equal(t, tc.want, mp.lastReq.Patterns)
			assert.Equal(t, []string{"*"}, mp.lastReq.Always)
			assert.Equal(t, tc.metadata, mp.lastReq.Metadata)
		})
	}
}

func TestExecuteTool(t *testing.T) {
	ctx := protocol.ToolContext{
		Ctx:        context.Background(),
		Permission: &mockPermission{},
	}

	toolsWithPerms := []string{
		"read", "write", "edit", "glob", "grep", "codesearch",
		"webfetch",
		"create_spreadsheet", "create_document", "create_presentation",
		"create_archive", "create_csv", "create_pdf", "create_chart", "create_site",
	}

	for _, tool := range toolsWithPerms {
		t.Run("execute "+tool, func(t *testing.T) {
			mp := &mockPermission{}
			ctx.Permission = mp

			args := map[string]any{"filePath": "test", "pattern": "test", "path": "test", "query": "test"}
			_ = ExecuteTool(ctx, tool, args)
			// we only care that it routed and asked permission
			assert.True(t, mp.asked, "Tool %s should have asked for permission", tool)
		})
	}

	toolsWithoutPerms := []string{
		"question", "task", "todowrite", "todoread",
		"plan_enter", "plan_exit", "invalid",
	}

	for _, tool := range toolsWithoutPerms {
		t.Run("execute "+tool, func(t *testing.T) {
			mp := &mockPermission{}
			ctx.Permission = mp

			args := map[string]any{"questions": []any{}}
			_ = ExecuteTool(ctx, tool, args)
			assert.False(t, mp.asked, "Tool %s should not ask for permission here", tool)
		})
	}

	t.Run("execute unknown tool", func(t *testing.T) {
		res := ExecuteTool(ctx, "unknown", nil)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "tool not found")
	})

	t.Run("execute context cancellation short-circuits before permission", func(t *testing.T) {
		canceledCtx, cancel := context.WithCancel(context.Background())
		cancel()
		mp := &mockPermission{}
		res := ExecuteTool(protocol.ToolContext{
			Ctx:        canceledCtx,
			Permission: mp,
		}, "read", map[string]any{"filePath": "a.txt"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "context canceled")
		assert.False(t, mp.asked)
	})

	t.Run("webfetch denied by net permission", func(t *testing.T) {
		mp := &mockPermission{err: errors.New("permission denied")}
		ctx.Permission = mp

		args := map[string]any{"url": "https://example.com/path"}
		res := ExecuteTool(ctx, "webfetch", args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "permission denied")
		assert.Equal(t, "net", mp.lastReq.Permission)
		assert.Equal(t, []string{"https://example.com/path", "example.com"}, mp.lastReq.Patterns)
	})
}

func TestExecuteToolCodeSearchPermissionUsesEffectivePattern(t *testing.T) {
	mp := &mockPermission{err: errors.New("permission denied")}
	res := ExecuteTool(protocol.ToolContext{
		Ctx:        context.Background(),
		Permission: mp,
	}, "codesearch", map[string]any{"pattern": "explicit-value"})

	assert.Equal(t, "error", res.Status)
	require.ErrorContains(t, errors.New(res.Error), "permission denied")
	assert.Equal(t, "grep", mp.lastReq.Permission)
	assert.Equal(t, []string{"explicit-value"}, mp.lastReq.Patterns)
}

func TestExecuteToolCodeSearchPrefersExplicitPattern(t *testing.T) {
	root := t.TempDir()
	err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("query-value"), 0o600)
	require.NoError(t, err)

	args := map[string]any{"query": "query-value", "pattern": "explicit-value"}
	res := ExecuteTool(protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: root,
	}, "codesearch", args)
	assert.Equal(t, "completed", res.Status)
	assert.Equal(t, "explicit-value", res.Title)
	assert.Equal(t, "explicit-value", args["pattern"])
}

func TestExecuteToolCodeSearchQueryFallback(t *testing.T) {
	root := t.TempDir()
	err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("needle"), 0o600)
	require.NoError(t, err)

	args := map[string]any{"query": "needle"}
	res := ExecuteTool(protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: root,
	}, "codesearch", args)
	assert.Equal(t, "completed", res.Status)
	assert.Equal(t, "needle", res.Title)
	assert.Contains(t, res.Output, "Found 1 matches")
	assert.Equal(t, "needle", args["pattern"])
}

func TestExecuteToolPermissionDeniedCoverageGapPaths(t *testing.T) {
	ctx := protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: t.TempDir(),
	}
	toolsWithPerms := []string{
		"read", "write", "edit", "glob", "grep", "codesearch",
		"webfetch", "create_spreadsheet", "create_document", "create_presentation",
		"create_archive", "create_csv", "create_pdf", "create_chart", "create_site",
	}
	args := map[string]any{
		"filePath": "test.txt",
		"pattern":  "test",
		"path":     ".",
		"query":    "test",
		"url":      "https://example.com",
		"slides":   []any{map[string]any{"title": "t"}},
		"files":    []any{"missing.txt"},
	}

	for _, tool := range toolsWithPerms {
		t.Run(tool+" permission denied", func(t *testing.T) {
			mp := &mockPermission{err: errors.New("permission denied")}
			res := ExecuteTool(protocol.ToolContext{
				Ctx:        ctx.Ctx,
				Cwd:        ctx.Cwd,
				Permission: mp,
			}, tool, args)
			assert.Equal(t, "error", res.Status)
			assert.Contains(t, res.Error, "permission denied")
			assert.True(t, mp.asked)
		})
	}
}

func TestExecuteToolUsesWorktreeWhenCwdMissing(t *testing.T) {
	worktree := t.TempDir()
	runner := t.TempDir()
	restore := util.SetRuntimeContextSource(util.RuntimeContextSourceFunc(func() util.RuntimeContext {
		return util.RuntimeContext{RootDir: runner, WorktreeDir: worktree}
	}))
	t.Cleanup(restore)

	oldWD, err := os.Getwd()
	require.NoError(t, err)
	err = os.Chdir(runner)
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	res := ExecuteTool(protocol.ToolContext{
		Ctx: context.Background(),
	}, "write", map[string]any{
		"filePath": "cwd-empty.txt",
		"content":  "hello",
	})

	assert.Equal(t, "completed", res.Status)
	assert.FileExists(t, filepath.Join(worktree, "cwd-empty.txt"))
	assert.NoFileExists(t, filepath.Join(runner, "cwd-empty.txt"))
}

func TestGetString(t *testing.T) {
	assert.Equal(t, "val", getString(map[string]any{"k": "val"}, "k"))
	assert.Empty(t, getString(map[string]any{"k": 123}, "k"))
	assert.Empty(t, getString(nil, "k"))
}
