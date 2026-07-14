package submission

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	attachmentcontract "github.com/TaskForceAI/go-engine/pkg/run/attachment"
	submissioncontract "github.com/TaskForceAI/go-engine/pkg/run/submission"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type TaskExecutor func(context.Context, string, int, string, string, taskcontract.OrchestrateOptions)
type ObservationFinisher func(startedAt time.Time, err error)
type ObservationStarter func(context.Context, submissioncontract.Request) (context.Context, ObservationFinisher)

type Runtime struct {
	RedisClient            func() (redis.Cmdable, error)
	AcquireExecutionSlot   func() (func(), bool)
	CapacityError          error
	DefaultAttachmentStore func(context.Context, attachmentcontract.Collection, string) error
	ExecuteInline          TaskExecutor
	ExecuteBackground      TaskExecutor
	StartObservation       ObservationStarter
	RecordQueueLatency     func(context.Context, time.Duration)
	MarshalReservation     func(any) ([]byte, error)
}

type Service struct {
	runtime Runtime
}

func New(runtime Runtime) *Service {
	if runtime.RedisClient == nil {
		runtime.RedisClient = func() (redis.Cmdable, error) { return nil, errors.New("redis unavailable") }
	}
	if runtime.AcquireExecutionSlot == nil {
		runtime.AcquireExecutionSlot = AcquireTaskExecutionSlot
	}
	if runtime.CapacityError == nil {
		runtime.CapacityError = ErrTaskExecutionCapacity
	}
	if runtime.ExecuteInline == nil {
		runtime.ExecuteInline = func(context.Context, string, int, string, string, taskcontract.OrchestrateOptions) {}
	}
	if runtime.ExecuteBackground == nil {
		runtime.ExecuteBackground = runtime.ExecuteInline
	}
	if runtime.StartObservation == nil {
		runtime.StartObservation = func(ctx context.Context, _ submissioncontract.Request) (context.Context, ObservationFinisher) {
			return ctx, func(time.Time, error) {}
		}
	}
	if runtime.RecordQueueLatency == nil {
		runtime.RecordQueueLatency = func(context.Context, time.Duration) {}
	}
	if runtime.MarshalReservation == nil {
		runtime.MarshalReservation = json.Marshal
	}
	return &Service{runtime: runtime}
}
