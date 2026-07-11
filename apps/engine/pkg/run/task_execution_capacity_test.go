package run

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoadMaxConcurrentTaskExecutionsBranches(t *testing.T) {
	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "")
	assert.Equal(t, DefaultMaxConcurrentTaskExecutions, LoadMaxConcurrentTaskExecutions())

	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "not-a-number")
	assert.Equal(t, DefaultMaxConcurrentTaskExecutions, LoadMaxConcurrentTaskExecutions())

	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "0")
	assert.Equal(t, DefaultMaxConcurrentTaskExecutions, LoadMaxConcurrentTaskExecutions())

	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "7")
	assert.Equal(t, 7, LoadMaxConcurrentTaskExecutions())

	assert.Positive(t, TaskExecutionSlotCapacity())
}

func TestAcquireTaskExecutionSlotRejectsWhenFull(t *testing.T) {
	releases := make([]func(), 0, TaskExecutionSlotCapacity())
	for {
		release, ok := AcquireTaskExecutionSlot()
		if !ok {
			break
		}
		releases = append(releases, release)
	}
	t.Cleanup(func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	})

	release, ok := AcquireTaskExecutionSlot()
	assert.False(t, ok)
	assert.Nil(t, release)
}
