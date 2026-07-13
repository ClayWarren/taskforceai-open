package tools

import (
	"context"
	"strings"
)

type computerUseContextKey string

const computerUseExecutionContextKey computerUseContextKey = "computerUseExecution"

type ComputerUseExecutionContext struct {
	SessionID           string
	ProfileKey          string
	UseLoggedInServices bool
}

func WithComputerUseExecutionContext(
	ctx context.Context,
	executionCtx ComputerUseExecutionContext,
) context.Context {
	if ctx == nil {
		return context.WithValue(context.Background(), computerUseExecutionContextKey, executionCtx)
	}
	return context.WithValue(ctx, computerUseExecutionContextKey, executionCtx)
}

func ComputerUseExecutionFromContext(ctx context.Context) ComputerUseExecutionContext {
	if ctx == nil {
		return ComputerUseExecutionContext{}
	}
	value := ctx.Value(computerUseExecutionContextKey)
	if execCtx, ok := value.(ComputerUseExecutionContext); ok {
		execCtx.SessionID = strings.TrimSpace(execCtx.SessionID)
		execCtx.ProfileKey = strings.TrimSpace(execCtx.ProfileKey)
		return execCtx
	}
	return ComputerUseExecutionContext{}
}
