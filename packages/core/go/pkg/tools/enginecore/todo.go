package tools

import (
	"fmt"
	"maps"
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type memoryTodoStore struct {
	mu   sync.Mutex
	list []map[string]any
}

func NewTodoStore() protocol.TodoStore {
	return &memoryTodoStore{}
}

func CloneTodoStore(store protocol.TodoStore) protocol.TodoStore {
	if store == nil {
		return NewTodoStore()
	}
	clone := NewTodoStore()
	clone.Set(store.Get())
	return clone
}

func cloneTodoItem(item map[string]any) map[string]any {
	if item == nil {
		return nil
	}
	out := make(map[string]any, len(item))
	maps.Copy(out, item)
	return out
}

func cloneTodoItems(items []map[string]any) []map[string]any {
	if len(items) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, len(items))
	for i, item := range items {
		out[i] = cloneTodoItem(item)
	}
	return out
}

func (s *memoryTodoStore) Get() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneTodoItems(s.list)
}

func (s *memoryTodoStore) Set(items []map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.list = cloneTodoItems(items)
}

var defaultTodoStore = NewTodoStore()

func resolveTodoStore(ctx protocol.ToolContext) protocol.TodoStore {
	if ctx.Todo != nil {
		return ctx.Todo
	}
	return defaultTodoStore
}

func toolTodoWrite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	parsed, missing, invalid := parseTodoArgs(args)
	if len(missing) > 0 {
		return invalidArgs("todowrite", args, missing...)
	}
	if invalid {
		return invalidArgs("todowrite", args, "invalid todos")
	}
	resolveTodoStore(ctx).Set(parsed.todos)
	state.Output = "[]"
	state.Title = fmt.Sprintf("%d todos", len(parsed.todos))
	state.TitleSet = true
	state.Metadata = map[string]any{
		"todos":     parsed.todos,
		"truncated": false,
	}
	return state
}

func toolTodoRead(ctx protocol.ToolContext, _ map[string]any) ToolResult {
	state := NewToolResult(map[string]any{})
	items := resolveTodoStore(ctx).Get()
	state.Input = map[string]any{}
	state.Output = "[]"
	state.Metadata = map[string]any{
		"todos":     items,
		"truncated": false,
	}
	state.Title = fmt.Sprintf("%d todos", len(items))
	state.TitleSet = true
	return state
}

func isMissingString(todo map[string]any, key string) bool {
	val, ok := todo[key]
	if !ok {
		return true
	}
	str, ok := val.(string)
	if !ok {
		return true
	}
	return str == ""
}

// issue/joinIssues removed; we now return a concise error.
