package util

import (
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
)

type RuntimeContext struct {
	RootDir     string
	WorktreeDir string
}

type RuntimeContextSource interface {
	RuntimeContext() RuntimeContext
}

type RuntimeContextSourceFunc func() RuntimeContext

func (f RuntimeContextSourceFunc) RuntimeContext() RuntimeContext {
	if f == nil {
		return RuntimeContext{}
	}
	return f()
}

type emptyRuntimeContextSource struct{}

func (emptyRuntimeContextSource) RuntimeContext() RuntimeContext {
	return RuntimeContext{}
}

var runtimeContextSources = runtimevalue.New[RuntimeContextSource](emptyRuntimeContextSource{})

func SetRuntimeContextSource(source RuntimeContextSource) func() {
	return runtimeContextSources.Set(source)
}

func runtimeContext() RuntimeContext {
	return runtimeContextSources.Current().RuntimeContext()
}

func Directory() string {
	context := runtimeContext()
	if root := strings.TrimSpace(context.RootDir); root != "" {
		return root
	}
	return "."
}

func Worktree() string {
	context := runtimeContext()
	if worktree := strings.TrimSpace(context.WorktreeDir); worktree != "" {
		return worktree
	}
	if root := strings.TrimSpace(context.RootDir); root != "" {
		return root
	}
	return "."
}
