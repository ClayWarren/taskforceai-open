package util

import (
	"strings"
	"sync"
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

var (
	runtimeContextSourceMu sync.RWMutex
	runtimeContextSource   RuntimeContextSource = emptyRuntimeContextSource{}
)

func SetRuntimeContextSource(source RuntimeContextSource) func() {
	if source == nil {
		source = emptyRuntimeContextSource{}
	}

	runtimeContextSourceMu.Lock()
	previous := runtimeContextSource
	runtimeContextSource = source
	runtimeContextSourceMu.Unlock()

	return func() {
		runtimeContextSourceMu.Lock()
		runtimeContextSource = previous
		runtimeContextSourceMu.Unlock()
	}
}

func runtimeContext() RuntimeContext {
	runtimeContextSourceMu.RLock()
	source := runtimeContextSource
	runtimeContextSourceMu.RUnlock()
	if source == nil {
		return RuntimeContext{}
	}
	return source.RuntimeContext()
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
