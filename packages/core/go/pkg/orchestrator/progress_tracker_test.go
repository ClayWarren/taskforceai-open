package orchestrator

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestProgressTracker(t *testing.T) {
	t.Run("Initialize and GetStatuses", func(t *testing.T) {
		pt := NewProgressTracker()
		pt.Initialize(2)
		statuses := pt.GetAgentStatuses()
		assert.Len(t, statuses, 2)
		assert.Equal(t, StatusQueued, statuses[0].Status)
	})

	t.Run("UpdateAgentProgress and Listeners", func(t *testing.T) {
		pt := NewProgressTracker()
		pt.Initialize(1)

		called := false
		unsubscribe := pt.OnUpdate(func(s []AgentStatusSnapshot) {
			called = true
		})
		defer unsubscribe()

		res := pt.UpdateAgentProgress(0, StatusProcessing, "working")
		assert.True(t, res.Ok)
		assert.True(t, called)

		statuses := pt.GetAgentStatuses()
		assert.Equal(t, StatusProcessing, statuses[0].Status)
		assert.Equal(t, "working", statuses[0].Result)
	})

	t.Run("Update unknown agent", func(t *testing.T) {
		pt := NewProgressTracker()
		res := pt.UpdateAgentProgress(99, StatusCompleted, "done")
		assert.False(t, res.Ok)
		assert.Equal(t, "UNKNOWN_AGENT", res.Error.Error())
	})
}

// TestProgressTracker_UnsubscribeAfterEarlierRemoval verifies that removing a listener
// at a lower position does not prevent later listeners from being unsubscribed.
// The old slice+index implementation would silently fail to remove listener B after
// listener A (registered before B) had already been removed, because A's removal
// compacted the slice and shifted B's captured index past the end.
func TestProgressTracker_UnsubscribeAfterEarlierRemoval(t *testing.T) {
	pt := NewProgressTracker()
	pt.Initialize(1)

	var callsA, callsB, callsC int

	unsubA := pt.OnUpdate(func(_ []AgentStatusSnapshot) { callsA++ })
	unsubB := pt.OnUpdate(func(_ []AgentStatusSnapshot) { callsB++ })
	unsubC := pt.OnUpdate(func(_ []AgentStatusSnapshot) { callsC++ })

	// All three fire on first update.
	pt.UpdateAgentProgress(0, StatusProcessing, "")
	assert.Equal(t, 1, callsA)
	assert.Equal(t, 1, callsB)
	assert.Equal(t, 1, callsC)

	// Remove A (lowest index / lowest ID).
	unsubA()

	// Remove B — this was the bug: B's captured index was now wrong after A's removal.
	unsubB()

	// C must still fire.
	pt.UpdateAgentProgress(0, StatusCompleted, "done")
	assert.Equal(t, 1, callsA, "A must not fire after unsubscribe")
	assert.Equal(t, 1, callsB, "B must not fire after unsubscribe")
	assert.Equal(t, 2, callsC, "C must still fire after A and B are removed")

	// C must also be removable.
	unsubC()
	pt.UpdateAgentProgress(0, StatusCompleted, "done")
	assert.Equal(t, 2, callsC, "C must not fire after its own unsubscribe")
}

// TestProgressTracker_UnsubscribeIdempotent verifies that calling an unsubscribe
// function more than once does not panic or double-remove.
func TestProgressTracker_UnsubscribeIdempotent(t *testing.T) {
	pt := NewProgressTracker()
	pt.Initialize(1)

	calls := 0
	unsub := pt.OnUpdate(func(_ []AgentStatusSnapshot) { calls++ })

	unsub()
	unsub() // must not panic

	pt.UpdateAgentProgress(0, StatusCompleted, "done")
	assert.Equal(t, 0, calls, "listener must not fire after unsubscribe")
}

func TestStatusToProgress(t *testing.T) {
	tests := []struct {
		status   AgentStatus
		expected float64
	}{
		{status: StatusQueued, expected: 0.05},
		{status: StatusProcessing, expected: 0.5},
		{status: StatusCompleted, expected: 1.0},
		{status: StatusFailed, expected: 1.0},
		{status: StatusTimeout, expected: 1.0},
		{status: AgentStatus("CUSTOM"), expected: 0.3},
	}

	for _, tc := range tests {
		assert.Equal(t, tc.expected, statusToProgress(tc.status))
	}
}

func TestProgressTracker_DetailedProgressMetadataAndRetention(t *testing.T) {
	pt := NewProgressTracker()
	pt.Initialize(1)
	pt.SetAgentModel(0, "openai/gpt-4.1")

	res := pt.UpdateAgentProgressDetailed(0, StatusProcessing, "first result", "initial reasoning")
	assert.True(t, res.Ok)

	// Repeated processing updates should increment and clamp at 0.95.
	for range 200 {
		res = pt.UpdateAgentProgressDetailed(0, StatusProcessing, "", "")
		assert.True(t, res.Ok)
	}

	getSnapshot := func(t *testing.T) AgentStatusSnapshot {
		t.Helper()
		for _, s := range pt.GetAgentStatuses() {
			if s.AgentID == 0 {
				return s
			}
		}
		t.Fatal("missing snapshot for agent 0")
		return AgentStatusSnapshot{}
	}

	processingSnap := getSnapshot(t)
	assert.Equal(t, StatusProcessing, processingSnap.Status)
	assert.Equal(t, 0.95, processingSnap.Progress)
	assert.Equal(t, "first result", processingSnap.Result)
	assert.Equal(t, "initial reasoning", processingSnap.Reasoning)
	assert.Equal(t, "openai/gpt-4.1", processingSnap.Model)

	// Empty result/reasoning should not erase previous values.
	res = pt.UpdateAgentProgressDetailed(0, StatusCompleted, "", "")
	assert.True(t, res.Ok)
	completedSnap := getSnapshot(t)
	assert.Equal(t, StatusCompleted, completedSnap.Status)
	assert.Equal(t, 1.0, completedSnap.Progress)
	assert.Equal(t, "first result", completedSnap.Result)
	assert.Equal(t, "initial reasoning", completedSnap.Reasoning)

	// Unknown statuses should use default progress mapping.
	res = pt.UpdateAgentProgressDetailed(0, AgentStatus("CUSTOM"), "", "")
	assert.True(t, res.Ok)
	customSnap := getSnapshot(t)
	assert.Equal(t, AgentStatus("CUSTOM"), customSnap.Status)
	assert.Equal(t, 0.3, customSnap.Progress)
}

func TestProgressTracker_ListenerCanReenterWithoutDeadlock(t *testing.T) {
	pt := NewProgressTracker()
	pt.Initialize(1)
	pt.OnUpdate(func(_ []AgentStatusSnapshot) {
		_ = pt.GetAgentStatuses()
	})

	done := make(chan struct{})
	go func() {
		_ = pt.UpdateAgentProgress(0, StatusProcessing, "working")
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("update deadlocked when listener re-entered tracker")
	}
}
