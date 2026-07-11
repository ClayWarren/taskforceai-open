package pulse

import "time"

// InteractionTrigger is a callback function that wakes an agent for a specific reason.
type InteractionTrigger func(agentID, reason string) error

// StatusChecker is a callback function that returns true if the agent is currently busy.
type StatusChecker func(agentID string) bool

// PulseState represents the scheduling state for a single agent.
type PulseState struct {
	AgentID      string
	Interval     time.Duration
	LastRun      time.Time
	NextDue      time.Time
	Active       *ActiveHours
	LastResponse string
	LastSentAt   time.Time
	ConsecFails  int
}

// DedupeResponse checks if the new response is a duplicate of the last one sent within 24h.
func (s *PulseState) DedupeResponse(text string, now time.Time) bool {
	if text == "" || s.LastResponse == "" {
		return false
	}
	// Only dedupe if sent within the last 24 hours
	if now.Sub(s.LastSentAt) > 24*time.Hour {
		return false
	}
	return s.LastResponse == text
}

// SystemEvent represents an ephemeral event that occurred in the background.
type SystemEvent struct {
	Text      string `json:"text"`
	Timestamp int64  `json:"ts"` // Unix Millis
}
