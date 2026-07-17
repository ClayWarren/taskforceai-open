package orchestrator

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskOrchestratorCancelSessionPrompt(t *testing.T) {
	orch := &TaskOrchestrator{
		sessionCancels: make(map[string]context.CancelFunc),
	}

	cancelled := make(chan struct{}, 1)
	orch.registerSessionCancel("session-1", func() {
		cancelled <- struct{}{}
	})

	ok := orch.CancelSessionPrompt("session-1")
	assert.True(t, ok)

	select {
	case <-cancelled:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected session cancellation to be triggered")
	}
}

func TestTeamSessionManagerCancelPrompt(t *testing.T) {
	manager := &TeamSessionManager{
		orch: &TaskOrchestrator{
			sessionCancels: make(map[string]context.CancelFunc),
		},
	}

	cancelled := make(chan struct{}, 1)
	manager.orch.registerSessionCancel("session-2", func() {
		cancelled <- struct{}{}
	})

	err := manager.CancelPrompt(context.Background(), "session-2")
	require.NoError(t, err)

	select {
	case <-cancelled:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected cancel prompt to invoke orchestration cancellation")
	}
}
