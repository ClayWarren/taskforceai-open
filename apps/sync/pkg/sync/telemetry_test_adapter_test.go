package sync

import (
	"context"
	"time"
)

type testTelemetry struct{}

func NewTelemetry() *testTelemetry { return &testTelemetry{} }

func (*testTelemetry) StartOperation(ctx context.Context, _ string) (context.Context, func(error)) {
	return ctx, func(error) {}
}

func (*testTelemetry) RecordSync(context.Context, string, time.Duration, int32, int32) {}

func (*testTelemetry) RecordConflict(context.Context, string) {}

func (*testTelemetry) RecordResolution(context.Context, ResolutionStrategy, bool, time.Duration) {}

func (*testTelemetry) RecordAutoMergeFieldChange(context.Context, string, string) {}
