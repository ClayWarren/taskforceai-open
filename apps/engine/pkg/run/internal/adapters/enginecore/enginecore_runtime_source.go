package enginecoreadapter

import (
	"os"

	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
)

type enginecoreEnvRuntimeSource struct{}

func installEnginecoreRuntimeSource() {
	enginecoreutil.SetRuntimeContextSource(enginecoreEnvRuntimeSource{})
	enginecoreutil.SetFileSystem(enginecoreOSFileSystem{})
}

func (enginecoreEnvRuntimeSource) RuntimeContext() enginecoreutil.RuntimeContext {
	root := enginecoreRuntimeDir()
	worktree := os.Getenv("TASKFORCEAI_CORE_WORKTREE")
	if worktree == "" {
		worktree = root
	}
	return enginecoreutil.RuntimeContext{
		RootDir:     root,
		WorktreeDir: worktree,
	}
}
