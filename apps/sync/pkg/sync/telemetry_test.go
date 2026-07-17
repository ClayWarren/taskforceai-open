package sync

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestTelemetry_NoPanics(t *testing.T) {
	tel := NewTelemetry()
	ctx := context.Background()

	ctx, finish := tel.StartOperation(ctx, "test.span")
	finish(nil)
	_, finishError := tel.StartOperation(ctx, "test.error_span")
	finishError(errors.New("boom"))
	tel.RecordSync(ctx, "PULL", 10*time.Millisecond, 5, 1)
	tel.RecordConflict(ctx, "conversation")
	tel.RecordResolution(ctx, StrategyServerWins, true, 5*time.Millisecond)
	tel.RecordResolution(ctx, StrategyClientWins, false, 7*time.Millisecond)
	tel.RecordAutoMergeFieldChange(ctx, "message", "content")
}
