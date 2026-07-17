package tools

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/TaskForceAI/core/pkg/patch"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func poolWithSandbox(sbx *fakeSandbox) *SandboxPool {
	return &SandboxPool{
		authConfigured: true,
		maxPoolSize:    1,
		pools:          map[string][]sandboxSession{"code:profile:user:1": {sbx}},
	}
}

func withUserProfile() context.Context {
	return WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{ProfileKey: "user:1"})
}

func TestSandboxReadToolDisabledWithoutCredentials(t *testing.T) {
	tool := CreateSandboxReadTool(&SandboxPool{})
	result, err := tool.Execute(context.Background(), `{"filePath":"a.txt"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxReadToolInvalidJSON(t *testing.T) {
	tool := CreateSandboxReadTool(&SandboxPool{authConfigured: true})
	_, err := tool.Execute(context.Background(), `not json`)
	assert.Error(t, err)
}

func TestSandboxReadToolMissingFilePath(t *testing.T) {
	tool := CreateSandboxReadTool(&SandboxPool{authConfigured: true})
	result, err := tool.Execute(context.Background(), `{}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxReadToolReturnsContentAndReusesSandbox(t *testing.T) {
	sbx := &fakeSandbox{id: "read", files: map[string][]byte{"a.txt": []byte("hello")}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxReadTool(pool)

	result, err := tool.Execute(withUserProfile(), `{"filePath":"a.txt"}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "hello", result["content"])
	require.Len(t, pool.pools["code:profile:user:1"], 1)
	assert.Same(t, sbx, pool.pools["code:profile:user:1"][0])
}

func TestSandboxReadToolMissingFileReportsErrorNotSessionFailure(t *testing.T) {
	sbx := &fakeSandbox{id: "read-missing", files: map[string][]byte{}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxReadTool(pool)

	result, err := tool.Execute(withUserProfile(), `{"filePath":"missing.txt"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["error"], "not found")
}

func failingSandboxPool() *SandboxPool {
	return NewSandboxPool(SandboxPoolOptions{
		AuthConfigured: true,
		Factory:        &fakeFactory{createErr: errors.New("acquire failed")},
	})
}

func TestSandboxFileToolsPropagateAcquireFailures(t *testing.T) {
	tests := []struct {
		name string
		tool ITool
		args string
	}{
		{"read", CreateSandboxReadTool(failingSandboxPool()), `{"filePath":"a.txt"}`},
		{"write", CreateSandboxWriteTool(failingSandboxPool()), `{"filePath":"a.txt","content":"x"}`},
		{"edit", CreateSandboxEditTool(failingSandboxPool()), `{"filePath":"a.txt","oldString":"a","newString":"b"}`},
		{"apply patch", CreateSandboxApplyPatchTool(failingSandboxPool()), `{"patch":"*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := tt.tool.Execute(context.Background(), tt.args)
			require.ErrorContains(t, err, "failed to acquire sandbox")
		})
	}
}

func TestSandboxWriteToolCreatesFile(t *testing.T) {
	sbx := &fakeSandbox{id: "write"}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxWriteTool(pool)

	result, err := tool.Execute(withUserProfile(), `{"filePath":"new.txt","content":"created"}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, []byte("created"), sbx.files["new.txt"])
}

func TestSandboxWriteToolMissingFilePath(t *testing.T) {
	tool := CreateSandboxWriteTool(&SandboxPool{authConfigured: true})
	result, err := tool.Execute(context.Background(), `{"content":"x"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxWriteToolDisabledWithoutCredentials(t *testing.T) {
	tool := CreateSandboxWriteTool(&SandboxPool{})
	result, err := tool.Execute(context.Background(), `{"filePath":"a.txt","content":"x"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxWriteToolInvalidJSONAndWriteFailure(t *testing.T) {
	tool := CreateSandboxWriteTool(&SandboxPool{authConfigured: true})
	_, err := tool.Execute(context.Background(), `{`)
	require.Error(t, err)

	sbx := &fakeSandbox{id: "write-error", writeErr: errors.New("write failed")}
	result, err := CreateSandboxWriteTool(poolWithSandbox(sbx)).Execute(withUserProfile(), `{"filePath":"a.txt","content":"x"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["error"], "write failed")
}

func TestSandboxEditToolReplacesExactString(t *testing.T) {
	sbx := &fakeSandbox{id: "edit", files: map[string][]byte{"a.txt": []byte("hello world")}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxEditTool(pool)

	result, err := tool.Execute(withUserProfile(), `{"filePath":"a.txt","oldString":"world","newString":"universe"}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, []byte("hello universe"), sbx.files["a.txt"])
}

func TestSandboxEditToolRejectsSameOldAndNewString(t *testing.T) {
	tool := CreateSandboxEditTool(&SandboxPool{authConfigured: true})
	result, err := tool.Execute(context.Background(), `{"filePath":"a.txt","oldString":"x","newString":"x"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxEditToolRejectsEmptyOldString(t *testing.T) {
	tool := CreateSandboxEditTool(&SandboxPool{authConfigured: true})
	result, err := tool.Execute(context.Background(), `{"filePath":"a.txt","oldString":"","newString":"x"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxEditToolOldStringNotFound(t *testing.T) {
	sbx := &fakeSandbox{id: "edit-miss", files: map[string][]byte{"a.txt": []byte("stable")}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxEditTool(pool)

	result, err := tool.Execute(withUserProfile(), `{"filePath":"a.txt","oldString":"missing","newString":"x"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["error"], "not found")
	assert.Equal(t, []byte("stable"), sbx.files["a.txt"])
}

func TestSandboxEditToolFileNotFound(t *testing.T) {
	sbx := &fakeSandbox{id: "edit-nofile", files: map[string][]byte{}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxEditTool(pool)

	result, err := tool.Execute(withUserProfile(), `{"filePath":"missing.txt","oldString":"a","newString":"b"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxEditToolValidationAndWriteFailure(t *testing.T) {
	result, err := CreateSandboxEditTool(nil).Execute(context.Background(), `{"filePath":"a.txt","oldString":"a","newString":"b"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])

	tool := CreateSandboxEditTool(&SandboxPool{authConfigured: true})
	_, err = tool.Execute(context.Background(), `{`)
	require.Error(t, err)
	result, err = tool.Execute(context.Background(), `{"oldString":"a","newString":"b"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])

	sbx := &fakeSandbox{id: "edit-write-error", files: map[string][]byte{"a.txt": []byte("a")}, writeErr: errors.New("write failed")}
	result, err = CreateSandboxEditTool(poolWithSandbox(sbx)).Execute(withUserProfile(), `{"filePath":"a.txt","oldString":"a","newString":"b"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["error"], "write failed")
}

func TestSandboxApplyPatchToolAddDeleteUpdateMove(t *testing.T) {
	sbx := &fakeSandbox{id: "patch", files: map[string][]byte{
		"old.txt":  []byte("content"),
		"gone.txt": []byte("bye"),
	}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxApplyPatchTool(pool)

	patchText := "*** Begin Patch\n" +
		"*** Add File: new.txt\n" +
		"+created\n" +
		"*** Delete File: gone.txt\n" +
		"*** Update File: old.txt\n" +
		"*** Move to: renamed.txt\n" +
		"@@\n" +
		"-content\n" +
		"+moved content\n" +
		"*** End Patch"

	result, err := tool.Execute(withUserProfile(), `{"patch":`+quoteJSON(patchText)+`}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, []byte("created"), sbx.files["new.txt"])
	_, stillThere := sbx.files["gone.txt"]
	assert.False(t, stillThere)
	assert.Equal(t, []byte("moved content"), sbx.files["renamed.txt"])
	_, oldStillThere := sbx.files["old.txt"]
	assert.False(t, oldStillThere)
}

func TestSandboxApplyPatchToolUpdatePreservesFinalNewline(t *testing.T) {
	sbx := &fakeSandbox{id: "patch-newline", files: map[string][]byte{
		"file.txt": []byte("line1\nline2\n"),
	}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxApplyPatchTool(pool)

	patchText := "*** Begin Patch\n" +
		"*** Update File: file.txt\n" +
		"@@\n" +
		" line1\n" +
		"-line2\n" +
		"+line-two\n" +
		"*** End Patch"

	result, err := tool.Execute(withUserProfile(), `{"patch":`+quoteJSON(patchText)+`}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, []byte("line1\nline-two\n"), sbx.files["file.txt"])
}

func TestSandboxApplyPatchToolPartialFailureReportsAppliedSoFar(t *testing.T) {
	sbx := &fakeSandbox{id: "patch-fail", files: map[string][]byte{}}
	pool := poolWithSandbox(sbx)
	tool := CreateSandboxApplyPatchTool(pool)

	patchText := "*** Begin Patch\n" +
		"*** Add File: first.txt\n" +
		"+created\n" +
		"*** Delete File: does-not-exist.txt\n" +
		"*** End Patch"

	result, err := tool.Execute(withUserProfile(), `{"patch":`+quoteJSON(patchText)+`}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["error"], "partially applied")
	assert.Contains(t, result["error"], "first.txt")
}

func TestSandboxApplyPatchToolInvalidGrammar(t *testing.T) {
	tool := CreateSandboxApplyPatchTool(&SandboxPool{authConfigured: true})
	result, err := tool.Execute(context.Background(), `{"patch":"nonsense"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxApplyPatchToolMissingPatch(t *testing.T) {
	tool := CreateSandboxApplyPatchTool(&SandboxPool{authConfigured: true})
	result, err := tool.Execute(context.Background(), `{}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxApplyPatchToolDisabledWithoutCredentials(t *testing.T) {
	tool := CreateSandboxApplyPatchTool(&SandboxPool{})
	result, err := tool.Execute(context.Background(), `{"patch":"*** Begin Patch\n*** End Patch"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
}

func TestSandboxApplyPatchToolValidationAndFirstFailure(t *testing.T) {
	tool := CreateSandboxApplyPatchTool(&SandboxPool{authConfigured: true})
	_, err := tool.Execute(context.Background(), `{`)
	require.Error(t, err)

	result, err := tool.Execute(context.Background(), `{"patch":"*** Begin Patch\n*** End Patch"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])

	sbx := &fakeSandbox{id: "patch-write-error", writeErr: errors.New("write failed")}
	tool = CreateSandboxApplyPatchTool(poolWithSandbox(sbx))
	result, err = tool.Execute(withUserProfile(), `{"patch":"*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["error"], "unable to apply patch")
}

func TestApplySandboxPatchOperationErrors(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name string
		sbx  *fakeSandbox
		op   patch.Op
	}{
		{"add write", &fakeSandbox{writeErr: errors.New("write failed")}, patch.Op{Kind: patch.Add, Path: "a.txt", AddLines: []string{"x"}}},
		{"delete", &fakeSandbox{deleteFileErr: errors.New("delete failed")}, patch.Op{Kind: patch.Delete, Path: "a.txt"}},
		{"update read", &fakeSandbox{readErr: errors.New("read failed")}, patch.Op{Kind: patch.Update, Path: "a.txt"}},
		{"update hunk", &fakeSandbox{files: map[string][]byte{"a.txt": []byte("a")}}, patch.Op{Kind: patch.Update, Path: "a.txt", Hunks: []patch.Hunk{{Lines: []patch.Line{{Kind: '-', Text: "missing"}}}}}},
		{"update write", &fakeSandbox{files: map[string][]byte{"a.txt": []byte("a")}, writeErr: errors.New("write failed")}, patch.Op{Kind: patch.Update, Path: "a.txt", Hunks: []patch.Hunk{{Lines: []patch.Line{{Kind: '-', Text: "a"}, {Kind: '+', Text: "b"}}}}}},
		{"move delete", &fakeSandbox{files: map[string][]byte{"a.txt": []byte("a")}, deleteFileErr: errors.New("delete failed")}, patch.Op{Kind: patch.Update, Path: "a.txt", MoveTo: "b.txt", Hunks: []patch.Hunk{{Lines: []patch.Line{{Kind: '-', Text: "a"}, {Kind: '+', Text: "b"}}}}}},
		{"unknown", &fakeSandbox{}, patch.Op{Kind: patch.OpKind("unknown"), Path: "a.txt"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := applySandboxPatchOp(ctx, tt.sbx, tt.op)
			require.Error(t, err)
		})
	}
}

func quoteJSON(s string) string {
	quoted, _ := json.Marshal(s)
	return string(quoted)
}
