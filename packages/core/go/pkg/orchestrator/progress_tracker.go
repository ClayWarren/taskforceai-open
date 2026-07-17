package orchestrator

import (
	"fmt"
	"maps"
	"sync"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/shared"
)

type AgentStatus string

const (
	StatusQueued     AgentStatus = "QUEUED"
	StatusProcessing AgentStatus = "PROCESSING..."
	StatusCompleted  AgentStatus = "COMPLETED"
	StatusFailed     AgentStatus = "FAILED"
	StatusTimeout    AgentStatus = "TIMEOUT"
)

type AgentStatusSnapshot struct {
	AgentID   int         `json:"agent_id"`
	Status    AgentStatus `json:"status"`
	Progress  float64     `json:"progress"`
	Result    string      `json:"result,omitempty"`
	Reasoning string      `json:"reasoning,omitempty"`
	Model     string      `json:"model,omitempty"`
}

type ProgressTracker struct {
	agentProgress  map[int]AgentStatus
	agentResults   map[int]string
	agentReasoning map[int]string
	agentModels    map[int]string
	agentNumeric   map[int]float64
	listeners      map[uint64]func([]AgentStatusSnapshot)
	nextListenerID uint64
	mu             sync.RWMutex
}

func NewProgressTracker() *ProgressTracker {
	return &ProgressTracker{
		agentProgress:  make(map[int]AgentStatus),
		agentResults:   make(map[int]string),
		agentReasoning: make(map[int]string),
		agentModels:    make(map[int]string),
		agentNumeric:   make(map[int]float64),
		listeners:      make(map[uint64]func([]AgentStatusSnapshot)),
	}
}

func statusToProgress(status AgentStatus) float64 {
	switch status {
	case StatusQueued:
		return 0.05
	case StatusProcessing:
		return 0.5
	case StatusCompleted, StatusFailed, StatusTimeout:
		return 1.0
	default:
		return 0.3
	}
}

func (p *ProgressTracker) SetAgentModel(agentID int, model string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.agentModels[agentID] = model
}

func (p *ProgressTracker) UpdateAgentProgress(agentID int, status AgentStatus, result string) shared.Result[struct{}] {
	return p.UpdateAgentProgressDetailed(agentID, status, result, "")
}

func (p *ProgressTracker) UpdateAgentProgressDetailed(agentID int, status AgentStatus, result string, reasoning string) shared.Result[struct{}] {
	p.mu.Lock()

	platform.GetLogger().Info("UpdateAgentProgress called", "agentId", agentID, "status", status, "hasResult", result != "", "hasReasoning", reasoning != "")

	if _, ok := p.agentProgress[agentID]; !ok {
		platform.GetLogger().Warn("UpdateAgentProgress: unknown agent", "agentId", agentID, "knownAgents", len(p.agentProgress))
		p.mu.Unlock()
		return shared.Err[struct{}](fmt.Errorf("UNKNOWN_AGENT"))
	}

	p.agentProgress[agentID] = status

	// Calculate numeric progress - if status is processing and we already have progress,
	// increment it slightly to show animation (up to 0.9 max before completion)
	currentProgress := p.agentNumeric[agentID]
	targetProgress := statusToProgress(status)

	if status == StatusProcessing && currentProgress > 0 {
		// Increment by 1% each update, max 0.95
		newProgress := currentProgress + 0.01
		if newProgress > 0.95 {
			newProgress = 0.95
		}
		p.agentNumeric[agentID] = newProgress
	} else {
		p.agentNumeric[agentID] = targetProgress
	}

	if result != "" {
		p.agentResults[agentID] = result
	}
	if reasoning != "" {
		p.agentReasoning[agentID] = reasoning
	}

	snapshots := p.buildSnapshotsLocked()
	listeners := p.copyListenersLocked()
	p.mu.Unlock()

	p.notify(listeners, snapshots)
	return shared.Ok(struct{}{})
}

func (p *ProgressTracker) GetAgentStatuses() []AgentStatusSnapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.buildSnapshotsLocked()
}

func (p *ProgressTracker) Initialize(numAgents int) {
	p.mu.Lock()

	platform.GetLogger().Info("ProgressTracker.Initialize", "numAgents", numAgents, "numListeners", len(p.listeners))

	p.agentProgress = make(map[int]AgentStatus)
	p.agentResults = make(map[int]string)
	p.agentReasoning = make(map[int]string)
	p.agentModels = make(map[int]string)
	p.agentNumeric = make(map[int]float64)
	for i := range numAgents {
		p.agentProgress[i] = StatusQueued
		p.agentNumeric[i] = 0.05
	}

	snapshots := p.buildSnapshotsLocked()
	listeners := p.copyListenersLocked()
	p.mu.Unlock()

	p.notify(listeners, snapshots)
}

func (p *ProgressTracker) OnUpdate(listener func([]AgentStatusSnapshot)) func() {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Assign a stable unique ID so the unsubscribe closure can find this entry
	// regardless of how many other listeners have been added or removed. The old
	// slice+index approach would silently fail to unsubscribe once any earlier
	// listener was removed (the captured index no longer matched the right slot).
	id := p.nextListenerID
	p.nextListenerID++
	p.listeners[id] = listener
	platform.GetLogger().Info("ProgressTracker.OnUpdate: listener registered", "totalListeners", len(p.listeners))

	removed := false
	return func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		if !removed {
			delete(p.listeners, id)
			removed = true
		}
	}
}
func (p *ProgressTracker) buildSnapshotsLocked() []AgentStatusSnapshot {
	snapshots := make([]AgentStatusSnapshot, 0, len(p.agentProgress))
	for id, status := range p.agentProgress {
		snapshots = append(snapshots, AgentStatusSnapshot{
			AgentID: id, Status: status, Progress: p.agentNumeric[id],
			Result: p.agentResults[id], Reasoning: p.agentReasoning[id], Model: p.agentModels[id],
		})
	}
	return snapshots
}

func (p *ProgressTracker) copyListenersLocked() map[uint64]func([]AgentStatusSnapshot) {
	listeners := make(map[uint64]func([]AgentStatusSnapshot), len(p.listeners))
	maps.Copy(listeners, p.listeners)
	return listeners
}

func (p *ProgressTracker) notify(listeners map[uint64]func([]AgentStatusSnapshot), snapshots []AgentStatusSnapshot) {
	platform.GetLogger().Info("Progress tracker notify", "numListeners", len(listeners), "numAgents", len(snapshots))

	for id, l := range listeners {
		platform.GetLogger().Debug("Calling listener", "id", id)
		l(snapshots)
	}
}
