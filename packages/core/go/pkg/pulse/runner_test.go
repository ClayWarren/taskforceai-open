package pulse

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunnerScheduling(t *testing.T) {
	var mu sync.Mutex
	triggers := make(map[string]int)

	trigger := func(agentID, reason string) error {
		mu.Lock()
		defer mu.Unlock()
		triggers[agentID]++
		return nil
	}

	events := NewEventStore()
	status := func(agentID string) bool { return false }
	runner := NewRunner(trigger, status, events)
	runner.checkFreq = 10 * time.Millisecond // Faster for testing

	agentID := "agent-1"
	runner.UpsertAgent(agentID, 50*time.Millisecond, nil) // Trigger every 50ms

	runner.Start()
	time.Sleep(120 * time.Millisecond) // Should trigger ~2 times
	runner.Stop()

	mu.Lock()
	count := triggers[agentID]
	mu.Unlock()

	if count < 2 {
		t.Errorf("Expected at least 2 triggers, got %d", count)
	}
}

func TestRunnerRemoveAgent(t *testing.T) {
	trigger := func(agentID, reason string) error { return nil }
	events := NewEventStore()
	status := func(agentID string) bool { return false }
	runner := NewRunner(trigger, status, events)

	// Add agent
	runner.UpsertAgent("agent-1", time.Hour, nil)

	// Verify agent exists
	runner.mu.RLock()
	_, exists := runner.agents["agent-1"]
	runner.mu.RUnlock()
	if !exists {
		t.Fatal("Agent should exist after UpsertAgent")
	}

	// Remove agent
	runner.RemoveAgent("agent-1")

	// Verify agent removed
	runner.mu.RLock()
	_, exists = runner.agents["agent-1"]
	runner.mu.RUnlock()
	if exists {
		t.Error("Agent should not exist after RemoveAgent")
	}

	// Remove non-existent agent should not panic
	runner.RemoveAgent("non-existent")
}

func TestRunnerRemoveAgentBeforeTriggerSkipsHeartbeat(t *testing.T) {
	statusEntered := make(chan struct{})
	releaseStatus := make(chan struct{})

	status := func(agentID string) bool {
		close(statusEntered)
		<-releaseStatus
		return false
	}

	var triggers atomic.Int32
	trigger := func(agentID, reason string) error {
		triggers.Add(1)
		return nil
	}

	runner := NewRunner(trigger, status, NewEventStore())
	runner.UpsertAgent("agent-1", time.Hour, nil)

	runner.mu.Lock()
	runner.agents["agent-1"].NextDue = time.Now().Add(-1 * time.Second)
	runner.mu.Unlock()

	done := make(chan struct{})
	go func() {
		runner.tick()
		close(done)
	}()

	<-statusEntered
	runner.RemoveAgent("agent-1")
	close(releaseStatus)
	<-done

	if got := triggers.Load(); got != 0 {
		t.Fatalf("Expected removed agent to be skipped before trigger, got %d triggers", got)
	}
}

func TestRunnerRequestImmediateHeartbeat(t *testing.T) {
	var mu sync.Mutex
	triggers := make(map[string]int)

	trigger := func(agentID, reason string) error {
		mu.Lock()
		defer mu.Unlock()
		triggers[agentID]++
		return nil
	}

	events := NewEventStore()
	status := func(agentID string) bool { return false }
	runner := NewRunner(trigger, status, events)

	// Test with trigger set
	runner.RequestImmediateHeartbeat("agent-1", "test-reason")

	mu.Lock()
	count := triggers["agent-1"]
	mu.Unlock()

	if count != 1 {
		t.Errorf("Expected 1 trigger, got %d", count)
	}

	// Test with nil trigger (should not panic)
	runnerNoTrigger := NewRunner(nil, status, events)
	runnerNoTrigger.RequestImmediateHeartbeat("agent-2", "test-reason")
}

func TestRunnerStartIsIdempotent(t *testing.T) {
	var triggers atomic.Int64
	trigger := func(agentID, reason string) error {
		triggers.Add(1)
		return nil
	}

	runner := NewRunner(trigger, func(string) bool { return false }, NewEventStore())
	runner.checkFreq = 10 * time.Millisecond
	runner.UpsertAgent("agent-1", 300*time.Millisecond, nil)

	runner.Start()
	runner.Start() // should be a no-op
	time.Sleep(500 * time.Millisecond)
	runner.Stop()

	if got := triggers.Load(); got != 1 {
		t.Errorf("Expected exactly 1 trigger with double Start, got %d", got)
	}
}

func TestRunnerStopIsIdempotent(t *testing.T) {
	runner := NewRunner(func(string, string) error { return nil }, func(string) bool { return false }, NewEventStore())
	runner.checkFreq = 10 * time.Millisecond

	runner.Start()
	time.Sleep(20 * time.Millisecond)
	runner.Stop()

	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("Second Stop should not panic, got: %v", recovered)
		}
	}()
	runner.Stop()
}

func TestRunnerCanRestartAfterStop(t *testing.T) {
	var triggers atomic.Int64
	trigger := func(agentID, reason string) error {
		triggers.Add(1)
		return nil
	}

	runner := NewRunner(trigger, func(string) bool { return false }, NewEventStore())
	runner.checkFreq = 10 * time.Millisecond
	runner.UpsertAgent("agent-1", 300*time.Millisecond, nil)

	runner.Start()
	time.Sleep(380 * time.Millisecond)
	runner.Stop()

	firstCount := triggers.Load()
	if firstCount < 1 {
		t.Fatalf("Expected at least one trigger before first stop, got %d", firstCount)
	}

	runner.Start()
	time.Sleep(380 * time.Millisecond)
	runner.Stop()

	secondCount := triggers.Load()
	if secondCount <= firstCount {
		t.Fatalf("Expected additional triggers after restart, first=%d second=%d", firstCount, secondCount)
	}
}

func TestRunnerCleansStaleEventsOnBackgroundLoop(t *testing.T) {
	events := NewEventStore()
	events.Enqueue("session-1", "stale event", "ctx")
	events.mu.Lock()
	events.queues["session-1"].lastActivity = time.Now().Add(-25 * time.Hour)
	events.mu.Unlock()

	runner := NewRunner(nil, nil, events)
	runner.checkFreq = time.Hour
	runner.cleanupFreq = 10 * time.Millisecond

	runner.Start()
	defer runner.Stop()

	deadline := time.After(500 * time.Millisecond)
	for events.HasEvents("session-1") {
		select {
		case <-deadline:
			t.Fatal("Expected background cleanup loop to remove stale session events")
		default:
			time.Sleep(5 * time.Millisecond)
		}
	}
}

func TestRunnerRunRecoversFromTickerPanic(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	runner.checkFreq = 0
	done := make(chan struct{})

	go runner.run(make(chan struct{}), done)

	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("expected runner goroutine to recover and close done")
	}
}

func TestRunnerStartAllowsRestartAfterRunLoopPanic(t *testing.T) {
	var triggers atomic.Int64
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)
	runner.checkFreq = 0

	runner.Start()

	deadline := time.After(250 * time.Millisecond)
	for runnerIsRunning(runner) {
		select {
		case <-deadline:
			t.Fatal("expected panicked runner loop to mark itself stopped")
		default:
			time.Sleep(5 * time.Millisecond)
		}
	}

	runner.checkFreq = 10 * time.Millisecond
	runner.UpsertAgent("agent-1", 20*time.Millisecond, nil)
	runner.Start()
	defer runner.Stop()

	deadline = time.After(250 * time.Millisecond)
	for triggers.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("expected runner to restart and trigger heartbeat")
		default:
			time.Sleep(5 * time.Millisecond)
		}
	}
}

func TestRunnerLoopContinuesAfterTickPanic(t *testing.T) {
	var triggers atomic.Int32
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)
	runner.checkFreq = 5 * time.Millisecond
	runner.UpsertAgent("agent-1", time.Hour, nil)
	runner.mu.Lock()
	runner.agents["bad-agent"] = nil
	runner.mu.Unlock()

	runner.Start()
	defer runner.Stop()

	time.Sleep(30 * time.Millisecond)
	runner.mu.Lock()
	delete(runner.agents, "bad-agent")
	runner.agents["agent-1"].NextDue = time.Now().Add(-time.Millisecond)
	runner.mu.Unlock()

	deadline := time.After(250 * time.Millisecond)
	for triggers.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("expected runner loop to continue after recovered tick panic")
		default:
			time.Sleep(5 * time.Millisecond)
		}
	}
}

func runnerIsRunning(runner *Runner) bool {
	runner.lifecycleMu.Lock()
	defer runner.lifecycleMu.Unlock()
	return runner.running
}

func TestRunnerAgentIDs(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	runner.UpsertAgent("agent-b", time.Hour, nil)
	runner.UpsertAgent("agent-a", time.Hour, nil)

	ids := runner.AgentIDs()
	if len(ids) != 2 {
		t.Fatalf("Expected 2 agent IDs, got %d", len(ids))
	}

	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if !seen["agent-a"] || !seen["agent-b"] {
		t.Fatalf("Expected agent-a and agent-b, got %v", ids)
	}
}

func TestRunnerUpsertAgentStateHydratesPersistedSchedule(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	lastRun := time.Now().Add(-5 * time.Minute).Truncate(time.Millisecond)
	nextDue := time.Now().Add(-time.Minute).Truncate(time.Millisecond)

	runner.UpsertAgentState("agent-1", time.Hour, nil, lastRun, nextDue)

	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if !state.LastRun.Equal(lastRun) {
		t.Fatalf("Expected hydrated last run %v, got %v", lastRun, state.LastRun)
	}
	if !state.NextDue.Equal(nextDue) {
		t.Fatalf("Expected hydrated next due %v, got %v", nextDue, state.NextDue)
	}
}

func TestRunnerUpsertAgentStateCapsStaleFutureSchedule(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	interval := time.Hour
	farFuture := time.Now().Add(24 * time.Hour)
	before := time.Now()

	runner.UpsertAgentState("agent-1", interval, nil, time.Time{}, farFuture)

	runner.mu.RLock()
	nextDue := runner.agents["agent-1"].NextDue
	runner.mu.RUnlock()
	if nextDue.Before(before.Add(interval)) || nextDue.After(time.Now().Add(interval+time.Second)) {
		t.Fatalf("Expected stale future next due to be capped near interval, got %v", nextDue)
	}
}

func TestRunnerUpsertAgentStateNormalizesNonPositiveInterval(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	before := time.Now()

	runner.UpsertAgentState("agent-1", 0, nil, time.Time{}, time.Time{})

	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if state.Interval != defaultCheckInterval {
		t.Fatalf("Expected invalid interval to normalize to %v, got %v", defaultCheckInterval, state.Interval)
	}
	if state.NextDue.Before(before.Add(defaultCheckInterval)) || state.NextDue.After(time.Now().Add(defaultCheckInterval+time.Second)) {
		t.Fatalf("Expected next due near normalized interval, got %v", state.NextDue)
	}
}

func TestRunnerUpsertAgentStateIgnoresStalePersistedSchedule(t *testing.T) {
	runner := NewRunner(nil, nil, nil)
	interval := time.Hour
	currentLastRun := time.Now().Add(-time.Minute).Truncate(time.Millisecond)
	currentNextDue := currentLastRun.Add(interval)
	staleLastRun := currentLastRun.Add(-10 * time.Minute)
	staleNextDue := time.Now().Add(-time.Minute).Truncate(time.Millisecond)

	runner.UpsertAgentState("agent-1", interval, nil, currentLastRun, currentNextDue)
	runner.UpsertAgentState("agent-1", interval, nil, staleLastRun, staleNextDue)

	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if !state.LastRun.Equal(currentLastRun) {
		t.Fatalf("Expected current last run to survive stale resync, got %v want %v", state.LastRun, currentLastRun)
	}
	if !state.NextDue.Equal(currentNextDue) {
		t.Fatalf("Expected current next due to survive stale resync, got %v want %v", state.NextDue, currentNextDue)
	}
}

func TestRunnerTickBusyAgentRetriesLater(t *testing.T) {
	var triggers atomic.Int32
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return true },
		nil,
	)
	runner.UpsertAgent("agent-1", time.Hour, nil)
	runner.mu.Lock()
	runner.agents["agent-1"].NextDue = time.Now().Add(-time.Second)
	runner.mu.Unlock()

	runner.tick()

	if got := triggers.Load(); got != 0 {
		t.Fatalf("Expected busy agent not to trigger, got %d triggers", got)
	}
	runner.mu.RLock()
	nextDue := runner.agents["agent-1"].NextDue
	runner.mu.RUnlock()
	if time.Until(nextDue) <= 0 {
		t.Fatalf("Expected busy agent to be rescheduled in the future, got %v", nextDue)
	}
}

func TestRunnerTickTriggerFailureBacksOffAndIncrementsFailure(t *testing.T) {
	runner := NewRunner(
		func(string, string) error { return errors.New("trigger failed") },
		func(string) bool { return false },
		nil,
	)
	runner.UpsertAgent("agent-1", time.Hour, nil)
	runner.mu.Lock()
	originalNextDue := time.Now().Add(-time.Second)
	runner.agents["agent-1"].NextDue = originalNextDue
	runner.mu.Unlock()

	beforeTick := time.Now()
	runner.tick()
	afterTick := time.Now()

	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if state.ConsecFails != 1 {
		t.Fatalf("Expected one consecutive failure, got %d", state.ConsecFails)
	}
	if !state.LastRun.IsZero() {
		t.Fatalf("Expected failed trigger not to update last run, got %v", state.LastRun)
	}
	if state.NextDue.Before(beforeTick.Add(triggerFailureMinBackoff)) ||
		state.NextDue.After(afterTick.Add(triggerFailureMinBackoff)) {
		t.Fatalf("Expected failed trigger to back off by %v, got %v", triggerFailureMinBackoff, state.NextDue)
	}
}

func TestRunnerRecordTriggerFailureIgnoresUnknownAgent(t *testing.T) {
	runner := NewRunner(
		func(string, string) error { return nil },
		func(string) bool { return false },
		nil,
	)

	// Recording a failure for an agent that is not tracked must be a no-op
	// rather than panic or create phantom state.
	runner.recordTriggerFailure("missing-agent", errors.New("boom"))

	runner.mu.RLock()
	_, ok := runner.agents["missing-agent"]
	runner.mu.RUnlock()
	if ok {
		t.Fatal("Expected no state to be created for an unknown agent")
	}
}

func TestTriggerFailureBackoffCaps(t *testing.T) {
	tests := []struct {
		failures int
		want     time.Duration
	}{
		{failures: 0, want: triggerFailureMinBackoff},
		{failures: 1, want: triggerFailureMinBackoff},
		{failures: 2, want: 2 * time.Minute},
		{failures: 3, want: 4 * time.Minute},
		{failures: 6, want: triggerFailureMaxBackoff},
		{failures: 50, want: triggerFailureMaxBackoff},
	}

	for _, tt := range tests {
		if got := triggerFailureBackoff(tt.failures); got != tt.want {
			t.Fatalf("triggerFailureBackoff(%d) = %v, want %v", tt.failures, got, tt.want)
		}
	}
}

func TestRunnerTickSkipsInactiveActiveHours(t *testing.T) {
	var triggers atomic.Int32
	now := time.Now().UTC()
	inactiveDay := int32((int(now.Weekday()) + 1) % 7) // #nosec G115
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)
	runner.UpsertAgent("agent-1", time.Hour, &ActiveHours{
		Start:    "00:00",
		End:      "00:00",
		Timezone: "UTC",
		Days:     []int32{inactiveDay},
	})
	runner.mu.Lock()
	originalNextDue := time.Now().Add(-time.Second)
	runner.agents["agent-1"].NextDue = originalNextDue
	runner.mu.Unlock()

	runner.tick()

	if got := triggers.Load(); got != 0 {
		t.Fatalf("Expected inactive agent not to trigger, got %d triggers", got)
	}
	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if !state.NextDue.Equal(originalNextDue) {
		t.Fatalf("Expected inactive agent to keep next due, got %v want %v", state.NextDue, originalNextDue)
	}
	if !state.LastRun.IsZero() {
		t.Fatalf("Expected inactive agent to keep zero last run, got %v", state.LastRun)
	}
}

func TestRunnerTickSuccessUpdatesScheduleAndResetsFailures(t *testing.T) {
	var triggers atomic.Int32
	var mu sync.Mutex
	var gotAgentID string
	var gotReason string
	interval := time.Hour
	runner := NewRunner(
		func(agentID, reason string) error {
			mu.Lock()
			gotAgentID = agentID
			gotReason = reason
			mu.Unlock()
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)
	runner.UpsertAgent("agent-1", interval, nil)
	runner.mu.Lock()
	originalNextDue := time.Now().Add(-time.Second)
	runner.agents["agent-1"].NextDue = originalNextDue
	runner.agents["agent-1"].ConsecFails = 2
	runner.mu.Unlock()

	beforeTick := time.Now()
	runner.tick()
	afterTick := time.Now()

	if got := triggers.Load(); got != 1 {
		t.Fatalf("Expected one trigger, got %d", got)
	}
	mu.Lock()
	triggerAgentID := gotAgentID
	triggerReason := gotReason
	mu.Unlock()
	if triggerAgentID != "agent-1" || triggerReason != "heartbeat" {
		t.Fatalf("Unexpected trigger arguments agentID=%q reason=%q", triggerAgentID, triggerReason)
	}
	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if state.LastRun.Before(beforeTick) || state.LastRun.After(afterTick) {
		t.Fatalf("Expected last run during tick, got %v between %v and %v", state.LastRun, beforeTick, afterTick)
	}
	if !state.NextDue.Equal(state.LastRun.Add(interval)) {
		t.Fatalf("Expected next due to follow interval, got %v want %v", state.NextDue, state.LastRun.Add(interval))
	}
	if state.ConsecFails != 0 {
		t.Fatalf("Expected successful trigger to reset failures, got %d", state.ConsecFails)
	}
}

func TestRunnerTickTriggersMultipleDueAgents(t *testing.T) {
	var triggers atomic.Int32
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)
	for _, agentID := range []string{"agent-1", "agent-2", "agent-3"} {
		runner.UpsertAgent(agentID, time.Hour, nil)
		runner.mu.Lock()
		runner.agents[agentID].NextDue = time.Now().Add(-time.Second)
		runner.mu.Unlock()
	}

	runner.tick()

	if got := triggers.Load(); got != 3 {
		t.Fatalf("Expected three due agents to trigger, got %d", got)
	}
}

func TestRunnerTriggerHeartbeatSkipsRemovedAgent(t *testing.T) {
	var triggers atomic.Int32
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)

	runner.triggerHeartbeat("missing-agent")

	if got := triggers.Load(); got != 0 {
		t.Fatalf("Expected missing agent not to trigger, got %d triggers", got)
	}
}

func TestRunnerTickRecoversFromTriggerPanic(t *testing.T) {
	runner := NewRunner(
		func(string, string) error { panic("trigger panic") },
		func(string) bool { return false },
		nil,
	)
	runner.UpsertAgent("agent-1", time.Hour, nil)
	runner.mu.Lock()
	originalNextDue := time.Now().Add(-time.Second)
	runner.agents["agent-1"].NextDue = originalNextDue
	runner.mu.Unlock()

	runner.tick()

	runner.mu.RLock()
	state := *runner.agents["agent-1"]
	runner.mu.RUnlock()
	if state.NextDue.Equal(originalNextDue) {
		t.Fatalf("Expected panicking trigger to move next due, still got original %v", originalNextDue)
	}
	if !state.LastRun.IsZero() {
		t.Fatalf("Expected panicking trigger not to update last run, got %v", state.LastRun)
	}
	if state.ConsecFails != 1 {
		t.Fatalf("Expected panicking trigger to increment failures, got %d", state.ConsecFails)
	}
	if time.Until(state.NextDue) <= 0 {
		t.Fatalf("Expected panicking trigger to be rescheduled in the future, got %v", state.NextDue)
	}
}

func TestRunnerRequestImmediateHeartbeatLogsTriggerError(t *testing.T) {
	runner := NewRunner(
		func(string, string) error { return errors.New("trigger failed") },
		nil,
		nil,
	)

	runner.RequestImmediateHeartbeat("agent-1", "manual")
}
