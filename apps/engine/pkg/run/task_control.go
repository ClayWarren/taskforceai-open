package run

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/go-engine/pkg/run/internal/taskcontrol"
)

const MaxApprovalDecisionPayloadBytes = taskcontrol.MaxApprovalDecisionPayloadBytes

var (
	ErrApprovalDecisionPayloadTooLarge = taskcontrol.ErrApprovalDecisionPayloadTooLarge
	ErrTaskSteeringEmpty               = taskcontrol.ErrTaskSteeringEmpty
	ErrTaskSteeringTooLarge            = taskcontrol.ErrTaskSteeringTooLarge
	ErrTaskSteeringQuota               = taskcontrol.ErrTaskSteeringQuota

	SendApprovalDecision = func(ctx context.Context, taskID string, decision ApprovalDecision) error {
		return taskcontrol.SendApprovalDecisionWithDependencies(ctx, taskID, decision, taskcontrol.ApprovalDependencies{
			RedisClient: RedisClientGetter, ApprovalClient: taskcontrol.DefaultApprovalClient,
		})
	}
	SendTaskSteering = func(ctx context.Context, taskID, input string) error {
		return taskcontrol.SendTaskSteeringWithClient(ctx, taskID, input, RedisClientGetter)
	}

	taskCancellations                 taskcontrol.CancellationRegistry
	taskCancellationPollIntervalNanos = (time.Second).Nanoseconds()
)

func getTaskCancellationPollInterval() time.Duration {
	return time.Duration(atomic.LoadInt64(&taskCancellationPollIntervalNanos))
}

func registerTaskCancellation(taskID string, cancel context.CancelFunc) func() {
	return taskCancellations.Register(taskID, cancel)
}

func CancelTaskExecution(taskID string) bool {
	return taskCancellations.Cancel(taskID)
}

func newTaskSteeringProvider(taskID string) orchestrator.SteeringProvider {
	return taskcontrol.NewTaskSteeringProviderWithClient(taskID, RedisClientGetter)
}
