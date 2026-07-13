package synctelemetry

import (
	"context"
	"errors"
	"testing"
	"time"

	syncpkg "github.com/TaskForceAI/go-sync/pkg/sync"
	"github.com/stretchr/testify/require"
)

func TestAdapterOperationsAndMetrics(t *testing.T) {
	adapter := New()
	require.NotNil(t, adapter)

	ctx, finish := adapter.StartOperation(context.Background(), "pull")
	finish(nil)
	_, finish = adapter.StartOperation(ctx, "push")
	finish(errors.New("sync failed"))

	adapter.RecordSync(ctx, "pull", 25*time.Millisecond, 4, 1)
	adapter.RecordConflict(ctx, "message")
	adapter.RecordResolution(ctx, syncpkg.ResolutionStrategy("server_wins"), true, 10*time.Millisecond)
	adapter.RecordResolution(ctx, syncpkg.ResolutionStrategy("client_wins"), false, 20*time.Millisecond)
	adapter.RecordAutoMergeFieldChange(ctx, "conversation", "title")
}
