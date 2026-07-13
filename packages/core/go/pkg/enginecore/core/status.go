package core

import "sync"

type StatusBus interface {
	Publish(sessionID string, status StatusInfo)
}

type SessionStatus struct {
	mu   sync.Mutex
	data map[string]StatusInfo
	bus  StatusBus
}

func NewSessionStatus(bus StatusBus) *SessionStatus {
	return &SessionStatus{
		data: map[string]StatusInfo{},
		bus:  bus,
	}
}

type BusStatusPublisher struct {
	Bus *Bus
}

func (b BusStatusPublisher) Publish(sessionID string, status StatusInfo) {
	if b.Bus == nil {
		return
	}
	b.Bus.Publish("session.status", map[string]any{
		"sessionID": sessionID,
		"status":    status,
	})
	if status.Type == StatusIdle {
		b.Bus.Publish("session.idle", map[string]any{
			"sessionID": sessionID,
		})
	}
}

func (s *SessionStatus) Get(sessionID string) StatusInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	if status, ok := s.data[sessionID]; ok {
		return status
	}
	return StatusInfo{Type: StatusIdle}
}

func (s *SessionStatus) Set(sessionID string, status StatusInfo) {
	s.mu.Lock()
	if status.Type == StatusIdle {
		delete(s.data, sessionID)
	} else {
		s.data[sessionID] = status
	}
	bus := s.bus
	s.mu.Unlock()

	if bus != nil {
		bus.Publish(sessionID, status)
	}
}
