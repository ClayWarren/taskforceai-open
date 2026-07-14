package run

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAttachmentPublicHelpers(t *testing.T) {
	withMockRedis(t)
	ctx := context.Background()

	assert.Equal(t, "text/csv", NormalizeUploadedAttachmentMIME("data.csv", "text/plain"))

	info := AttachmentInfo{MimeType: "text/plain", Name: "note.txt", Size: 4}
	require.NoError(t, StoreAttachmentInfo(ctx, "file-1", info, time.Minute))
	storedInfo, found, err := GetAttachmentInfo(ctx, "file-1")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, info, *storedInfo)

	attachments := Attachments{Files: []FileAttachment{{ID: "file-1", MimeType: "text/plain", Name: "note.txt", Size: 4}}}
	require.NoError(t, StoreAttachments(ctx, attachments, "task-1"))
	require.NoError(t, StoreAttachment(ctx, "file-1", []byte("note"), time.Minute))
	data, err := GetAttachment(ctx, "file-1")
	require.NoError(t, err)
	assert.Equal(t, []byte("note"), data)
}

func TestRunFacadeHelpers(t *testing.T) {
	restore(t, &acquireTaskExecutionSlot)
	released := false
	acquireTaskExecutionSlot = func() (func(), bool) { return func() { released = true }, true }
	release, ok := AcquireTaskExecutionSlot()
	require.True(t, ok)
	release()
	assert.True(t, released)
	assert.Positive(t, TaskExecutionSlotCapacity())

	assert.NotNil(t, NewRepositoryFromQueries(nil))
	assert.Positive(t, getTaskCancellationPollInterval())
	canceled := false
	clear := registerTaskCancellation("coverage-task", func() { canceled = true })
	t.Cleanup(clear)
	assert.True(t, CancelTaskExecution("coverage-task"))
	assert.True(t, canceled)
	assert.NotNil(t, newTaskSteeringProvider("coverage-task"))
	require.Error(t, SendTaskSteering(context.Background(), "coverage-task", " "))
	require.NoError(t, SendApprovalDecision(context.Background(), "coverage-task", ApprovalDecision{Approved: true}))
}

func TestSubmissionFacadeAndBackgroundExecutor(t *testing.T) {
	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{}, TaskSubmissionDeps{})
	require.Error(t, err)

	restore(t, &executeSubmittedTaskInline)
	done := make(chan struct{})
	executeSubmittedTaskInline = func(context.Context, string, int, string, string, OrchestrateTaskOptions) {
		close(done)
	}
	executeSubmittedTaskBackground(context.Background(), "task-1", 1, "prompt", "model", OrchestrateTaskOptions{})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("background task executor did not run")
	}
}

func TestGeneratedFileFacadeRunsObservation(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withDBQueries(t, db.New(mock))
	invalidPath := filepath.Join(t.TempDir(), "missing-chart.png")
	events := []agent.ToolEvent{{
		ToolName: "create_chart",
		GeneratedFile: &agent.GeneratedFile{
			Filename:  "chart.png",
			Filepath:  "chart.png",
			MimeType:  "image/png",
			ToolName:  "create_chart",
			LocalPath: invalidPath,
		},
	}}

	result, err := persistGeneratedFileArtifacts(context.Background(), GeneratedFilePersistenceInput{Events: events})
	require.NoError(t, err)
	assert.Equal(t, events, result)
}
