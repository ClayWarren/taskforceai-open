package tools

import (
	"context"
	"testing"
)

func TestComputerUseExecutionContextHandlesNilAndTrimsValues(t *testing.T) {
	execCtx := ComputerUseExecutionContext{
		SessionID:           " session ",
		ProfileKey:          " profile ",
		UseLoggedInServices: true,
	}
	ctx := WithComputerUseExecutionContext(nilContext(), execCtx)
	got := ComputerUseExecutionFromContext(ctx)
	if got.SessionID != "session" || got.ProfileKey != "profile" || !got.UseLoggedInServices {
		t.Fatalf("unexpected execution context: %#v", got)
	}
	if empty := ComputerUseExecutionFromContext(nilContext()); empty != (ComputerUseExecutionContext{}) {
		t.Fatalf("nil context should return empty execution context")
	}
	if empty := ComputerUseExecutionFromContext(context.WithValue(context.Background(), computerUseExecutionContextKey, "wrong")); empty != (ComputerUseExecutionContext{}) {
		t.Fatalf("wrong value type should return empty execution context")
	}
}

func nilContext() context.Context {
	return nil
}
