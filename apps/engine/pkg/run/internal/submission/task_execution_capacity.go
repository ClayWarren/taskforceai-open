package submission

import (
	"errors"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

const DefaultMaxConcurrentTaskExecutions = 32

var (
	ErrTaskExecutionCapacity = errors.New("task execution capacity reached")
	taskExecutionSlots       = make(chan struct{}, LoadMaxConcurrentTaskExecutions())
	acquireTaskExecutionSlot = func() (func(), bool) {
		select {
		case taskExecutionSlots <- struct{}{}:
			return func() {
				<-taskExecutionSlots
			}, true
		default:
			return nil, false
		}
	}
)

func AcquireTaskExecutionSlot() (func(), bool) {
	return acquireTaskExecutionSlot()
}

func TaskExecutionSlotCapacity() int {
	return cap(taskExecutionSlots)
}

func LoadMaxConcurrentTaskExecutions() int {
	raw := strings.TrimSpace(os.Getenv("INNGEST_MAX_CONCURRENT_TASKS"))
	if raw == "" {
		return DefaultMaxConcurrentTaskExecutions
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		slog.Warn("[TaskExecution] Invalid INNGEST_MAX_CONCURRENT_TASKS, using default", "value", raw, "default", DefaultMaxConcurrentTaskExecutions)
		return DefaultMaxConcurrentTaskExecutions
	}
	return value
}
