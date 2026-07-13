package pulse

import (
	"fmt"
	"log/slog"
	"sync"
	"time"
)

const defaultCheckInterval = 10 * time.Second

const (
	triggerFailureMinBackoff = time.Minute
	triggerFailureMaxBackoff = 30 * time.Minute
)

// Runner manages the background lifecycle of multiple agents.
type Runner struct {
	mu          sync.RWMutex
	lifecycleMu sync.Mutex
	agents      map[string]*PulseState
	trigger     InteractionTrigger
	status      StatusChecker
	events      *EventStore
	stop        chan struct{}
	done        chan struct{}
	running     bool
	checkFreq   time.Duration
	cleanupFreq time.Duration
}

// NewRunner creates a new pulse runner.
func NewRunner(trigger InteractionTrigger, status StatusChecker, events *EventStore) *Runner {
	return &Runner{
		agents:      make(map[string]*PulseState),
		trigger:     trigger,
		status:      status,
		events:      events,
		checkFreq:   defaultCheckInterval,
		cleanupFreq: 1 * time.Hour,
	}
}

// Start begins the background scheduling loop.
func (r *Runner) Start() {
	r.lifecycleMu.Lock()
	defer r.lifecycleMu.Unlock()

	if r.running {
		return
	}

	stop := make(chan struct{})
	done := make(chan struct{})
	r.stop = stop
	r.done = done
	r.running = true
	go r.run(stop, done)
	slog.Info("Pulse runner started")
}

// Stop halts the background scheduling loop.
func (r *Runner) Stop() {
	r.lifecycleMu.Lock()
	if !r.running || r.stop == nil || r.done == nil {
		r.lifecycleMu.Unlock()
		return
	}

	stop := r.stop
	done := r.done
	r.running = false
	r.stop = nil
	r.done = nil
	close(stop)
	r.lifecycleMu.Unlock()

	<-done
	slog.Info("Pulse runner stopped")
}

// UpsertAgent adds or updates an agent's scheduling configuration.
func (r *Runner) UpsertAgent(agentID string, interval time.Duration, active *ActiveHours) {
	r.UpsertAgentState(agentID, interval, active, time.Time{}, time.Time{})
}

// UpsertAgentState adds or updates an agent's scheduling configuration with persisted state.
func (r *Runner) UpsertAgentState(agentID string, interval time.Duration, active *ActiveHours, lastRun, nextDue time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if interval <= 0 {
		slog.Warn("Pulse invalid agent interval, using default interval", "agentId", agentID, "interval", interval, "defaultInterval", defaultCheckInterval)
		interval = defaultCheckInterval
	}

	now := time.Now()
	state, ok := r.agents[agentID]
	if !ok {
		state = &PulseState{
			AgentID: agentID,
		}
		r.agents[agentID] = state
	}

	isNewState := state.LastRun.IsZero() && state.NextDue.IsZero()
	shouldHydratePersistedSchedule := isNewState ||
		(!lastRun.IsZero() && (state.LastRun.IsZero() || lastRun.After(state.LastRun)))

	state.Interval = interval
	state.Active = active
	if shouldHydratePersistedSchedule {
		if !lastRun.IsZero() {
			state.LastRun = lastRun
		}
		if !nextDue.IsZero() {
			state.NextDue = nextDue
		}
	}

	// If the next due time is zero or significantly in the future, initialize it.
	if state.NextDue.IsZero() || state.NextDue.After(now.Add(interval)) {
		state.NextDue = now.Add(interval)
	}
}

// RemoveAgent removes an agent from the scheduler.
func (r *Runner) RemoveAgent(agentID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.agents, agentID)
}

func (r *Runner) run(stop chan struct{}, done chan struct{}) {
	defer r.finishRun(stop, done)
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("Pulse runner background routine panic", "panic", recovered)
		}
	}()
	ticker := time.NewTicker(r.checkFreq)
	defer ticker.Stop()
	cleanupTicker := time.NewTicker(r.cleanupFreq)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-ticker.C:
			r.runProtected("tick", r.tick)
		case <-cleanupTicker.C:
			if r.events != nil {
				// Clean up session events older than 24 hours
				r.runProtected("cleanup", func() {
					r.events.Cleanup(24 * time.Hour)
				})
			}
		case <-stop:
			return
		}
	}
}

func (r *Runner) finishRun(stop chan struct{}, done chan struct{}) {
	r.lifecycleMu.Lock()
	if r.running && r.stop == stop && r.done == done {
		r.running = false
		r.stop = nil
		r.done = nil
	}
	r.lifecycleMu.Unlock()
	close(done)
}

func (r *Runner) runProtected(operation string, fn func()) {
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("Pulse runner background operation panic", "operation", operation, "panic", recovered)
		}
	}()
	fn()
}

func (r *Runner) tick() {
	now := time.Now()
	dueAgentIDs := r.dueAgentIDs(now)
	if len(dueAgentIDs) == 0 {
		return
	}
	if len(dueAgentIDs) == 1 {
		r.triggerHeartbeat(dueAgentIDs[0])
		return
	}

	r.triggerHeartbeats(dueAgentIDs)
}

func (r *Runner) dueAgentIDs(now time.Time) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// Copy only due agent IDs to avoid holding the lock during triggers.
	var dueAgentIDs []string
	for _, state := range r.agents {
		if now.Before(state.NextDue) {
			continue
		}

		if !IsWithinActiveHours(now, state.Active) {
			continue
		}

		dueAgentIDs = append(dueAgentIDs, state.AgentID)
	}
	return dueAgentIDs
}

func (r *Runner) triggerHeartbeats(agentIDs []string) {
	workerCount := min(len(agentIDs), 10)
	var wg sync.WaitGroup
	wg.Add(workerCount)
	for worker := range workerCount {
		go func(start int) {
			defer wg.Done()
			for i := start; i < len(agentIDs); i += workerCount {
				r.triggerHeartbeat(agentIDs[i])
			}
		}(worker)
	}

	// Wait for all heartbeats in this tick to complete (or time out via triggers)
	wg.Wait()
}

func (r *Runner) triggerHeartbeat(agentID string) {
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("Pulse agent heartbeat panic", "agentId", agentID, "panic", recovered)
			r.recordTriggerFailure(agentID, fmt.Errorf("panic: %v", recovered))
		}
	}()

	if !r.hasAgent(agentID) {
		return
	}

	// Check if agent is busy (retry later if so)
	if r.status != nil && r.status(agentID) {
		slog.Info("Pulse agent is busy, retrying", "agentId", agentID, "retryIn", time.Minute.String())
		r.mu.Lock()
		if actualState, ok := r.agents[agentID]; ok {
			actualState.NextDue = time.Now().Add(time.Minute)
		}
		r.mu.Unlock()
		return
	}

	if !r.hasAgent(agentID) {
		return
	}

	// Trigger the heartbeat
	slog.Info("Pulse triggering heartbeat", "agentId", agentID)
	triggerOK := true
	if r.trigger != nil {
		if err := r.trigger(agentID, "heartbeat"); err != nil {
			triggerOK = false
			r.recordTriggerFailure(agentID, err)
		}
	}

	// Only update scheduling state on successful trigger
	if triggerOK {
		r.mu.Lock()
		if actualState, ok := r.agents[agentID]; ok {
			actualState.LastRun = time.Now()
			actualState.NextDue = actualState.LastRun.Add(actualState.Interval)
			actualState.ConsecFails = 0
		}
		r.mu.Unlock()
	}
}

func (r *Runner) recordTriggerFailure(agentID string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	actualState, ok := r.agents[agentID]
	if !ok {
		return
	}
	actualState.ConsecFails++
	backoff := triggerFailureBackoff(actualState.ConsecFails)
	actualState.NextDue = time.Now().Add(backoff)
	slog.Warn(
		"Pulse heartbeat trigger failed",
		"agentId", agentID,
		"consecutiveFailures", actualState.ConsecFails,
		"retryIn", backoff.String(),
		"error", err,
	)
}

func triggerFailureBackoff(consecutiveFailures int) time.Duration {
	if consecutiveFailures <= 1 {
		return triggerFailureMinBackoff
	}
	backoff := triggerFailureMinBackoff
	for range min(consecutiveFailures-1, 8) {
		backoff *= 2
		if backoff >= triggerFailureMaxBackoff {
			return triggerFailureMaxBackoff
		}
	}
	return backoff
}

func (r *Runner) hasAgent(agentID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.agents[agentID]
	return ok
}

// AgentIDs returns the IDs of all agents currently registered in the runner.
func (r *Runner) AgentIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.agents))
	for id := range r.agents {
		ids = append(ids, id)
	}
	return ids
}

// RequestImmediateHeartbeat manually triggers a wake-up for an agent.
func (r *Runner) RequestImmediateHeartbeat(agentID, reason string) {
	if r.trigger != nil {
		if err := r.trigger(agentID, reason); err != nil {
			slog.Warn("Pulse immediate heartbeat trigger failed", "agentId", agentID, "reason", reason, "error", err)
		}
	}
}
