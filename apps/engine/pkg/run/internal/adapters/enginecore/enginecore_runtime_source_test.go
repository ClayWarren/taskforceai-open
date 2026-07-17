package enginecoreadapter

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreEnvRuntimeSourceUsesRootAndWorktree(t *testing.T) {
	root := t.TempDir()
	worktree := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_ROOT", root)
	t.Setenv("TASKFORCEAI_CORE_WORKTREE", worktree)

	context := (enginecoreEnvRuntimeSource{}).RuntimeContext()
	assert.Equal(t, root, context.RootDir)
	assert.Equal(t, worktree, context.WorktreeDir)
}

func TestEnginecoreEnvRuntimeSourceFallsBackToCwd(t *testing.T) {
	dir := t.TempDir()
	oldWD, err := os.Getwd()
	require.NoError(t, err)
	require.NoError(t, os.Chdir(dir))
	t.Cleanup(func() {
		_ = os.Chdir(oldWD)
	})

	t.Setenv("TASKFORCEAI_CORE_ROOT", "")
	t.Setenv("TASKFORCEAI_CORE_WORKTREE", "")
	want, err := os.Getwd()
	require.NoError(t, err)

	context := (enginecoreEnvRuntimeSource{}).RuntimeContext()
	assert.Equal(t, want, context.RootDir)
	assert.Equal(t, want, context.WorktreeDir)
}

func TestEnginecoreAdapterInstallationLifecycle(t *testing.T) {
	ResetForTest()
	t.Cleanup(ResetForTest)

	InstallSources()
	Install()
	Install()
	ResetForTest()
}
