package submission

import (
	"context"
	"testing"
	"time"

	submissioncontract "github.com/TaskForceAI/go-engine/pkg/run/submission"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewAppliesRuntimeDefaults(t *testing.T) {
	service := New(Runtime{})
	require.NotNil(t, service)

	_, err := service.runtime.RedisClient()
	require.ErrorContains(t, err, "redis unavailable")
	require.ErrorIs(t, service.runtime.CapacityError, ErrTaskExecutionCapacity)
	service.runtime.ExecuteInline(context.Background(), "task", 1, "prompt", "model", OrchestrateTaskOptions{})
	service.runtime.ExecuteBackground(context.Background(), "task", 1, "prompt", "model", OrchestrateTaskOptions{})

	ctx, finish := service.runtime.StartObservation(context.Background(), submissioncontract.Request{})
	assert.NotNil(t, ctx)
	finish(time.Now(), nil)
	service.runtime.RecordQueueLatency(context.Background(), time.Second)
	data, err := service.runtime.MarshalReservation(map[string]string{"ok": "yes"})
	require.NoError(t, err)
	assert.JSONEq(t, `{"ok":"yes"}`, string(data))

	release, ok := service.runtime.AcquireExecutionSlot()
	if ok {
		release()
	}
}

func TestStoreSubmissionAttachmentsRequiresStore(t *testing.T) {
	service := New(Runtime{})
	err := service.storeSubmissionAttachments(
		context.Background(),
		TaskSubmissionRequest{Attachments: Attachments{Files: []FileAttachment{{ID: "file-1"}}}},
		TaskSubmissionDeps{},
		"task-1",
	)
	require.ErrorContains(t, err, "attachment store is required")
}
