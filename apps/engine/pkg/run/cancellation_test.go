package run

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/require"
)

type panicGetRegistrar struct {
	TaskRegistrar
	called chan struct{}
}

func (r panicGetRegistrar) Get(string) *TaskState {
	close(r.called)
	panic("registry panic")
}

func TestCancelTaskExecutionInvokesRegisteredCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	clear := registerTaskCancellation("task-cancel", cancel)
	defer clear()

	if !CancelTaskExecution("task-cancel") {
		t.Fatal("expected registered task cancellation to be found")
	}

	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected task context to be canceled")
	}
}

func TestCancellationMonitorObservesSharedCanceledState(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	registry := GetRegistry()
	taskID := "task-distributed-cancel"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	previous := atomic.SwapInt64(&taskCancellationPollIntervalNanos, time.Millisecond.Nanoseconds())
	t.Cleanup(func() { atomic.StoreInt64(&taskCancellationPollIntervalNanos, previous) })
	ctx, cancel := context.WithCancel(context.Background())
	runner := newOrchestrateTaskRunner(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}, registry)
	stop := runner.startCancellationMonitor(ctx, cancel)
	defer stop()

	require.NoError(t, registry.Update(context.Background(), taskID, StatusCanceled, "", "Run canceled"))
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("distributed cancellation was not observed")
	}
}

func TestCancelTaskExecutionReturnsFalseForMissingTask(t *testing.T) {
	if CancelTaskExecution("missing-task") {
		t.Fatal("missing task should not cancel")
	}
}

func TestCancelTaskExecutionBranches(t *testing.T) {
	clear := registerTaskCancellation("", func() {})
	clear()
	clear = registerTaskCancellation("nil-cancel", nil)
	clear()

	if CancelTaskExecution("") {
		t.Fatal("empty task should not cancel")
	}

	taskCancellationRegistry.Store("bad-cancel", "not-a-cancel-func")
	if CancelTaskExecution("bad-cancel") {
		t.Fatal("invalid cancellation value should not cancel")
	}
	if _, ok := taskCancellationRegistry.Load("bad-cancel"); ok {
		t.Fatal("invalid cancellation value should be deleted")
	}
}

func TestCancellationMonitorUsesDefaultIntervalForNonPositiveConfiguration(t *testing.T) {
	previous := atomic.SwapInt64(&taskCancellationPollIntervalNanos, 0)
	t.Cleanup(func() { atomic.StoreInt64(&taskCancellationPollIntervalNanos, previous) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	runner := newOrchestrateTaskRunner("task-default-poll", 1, "prompt", "gpt-4", OrchestrateTaskOptions{}, new(mockTaskRegistrar))
	stop := runner.startCancellationMonitor(ctx, func() {})
	stop()
}

func TestCancellationMonitorRecoversRegistryPanics(t *testing.T) {
	previous := atomic.SwapInt64(&taskCancellationPollIntervalNanos, time.Millisecond.Nanoseconds())
	t.Cleanup(func() { atomic.StoreInt64(&taskCancellationPollIntervalNanos, previous) })
	called := make(chan struct{})
	runner := newOrchestrateTaskRunner(
		"task-panic-poll",
		1,
		"prompt",
		"gpt-4",
		OrchestrateTaskOptions{},
		panicGetRegistrar{called: called},
	)
	stop := runner.startCancellationMonitor(context.Background(), func() {})
	defer stop()

	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("cancellation monitor did not poll registry")
	}
}

func TestOrchestrateTaskRunnerStopsWhenTaskIsCanceledAfterClaim(t *testing.T) {
	registry := new(mockTaskRegistrar)
	state := &TaskState{TaskID: "task-canceled-after-claim", Status: StatusCanceled}
	registry.On("MarkStartedWithError", state.TaskID).Return(true, nil).Once()
	registry.On("Get", state.TaskID).Return(state)

	runner := newOrchestrateTaskRunner(state.TaskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}, registry)
	runner.run(context.Background())

	registry.AssertExpectations(t)
}
