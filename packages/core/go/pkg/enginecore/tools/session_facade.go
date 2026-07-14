package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/session"
)

func NewTodoStore() protocol.TodoStore { return session.NewTodoStore() }

func CloneTodoStore(store protocol.TodoStore) protocol.TodoStore {
	return session.CloneTodoStore(store)
}

func toolQuestion(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return session.ExecuteQuestion(ctx, args)
}

func toolTask(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return session.ExecuteTask(ctx, args)
}

func toolTodoWrite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return session.ExecuteTodoWrite(ctx, args)
}

func toolTodoRead(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return session.ExecuteTodoRead(ctx, args)
}

func toolPlanEnter(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return session.ExecutePlanEnter(ctx, args)
}

func toolPlanExit(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return session.ExecutePlanExit(ctx, args)
}
