package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockStatusBus struct {
	sessionID string
	status    StatusInfo
}

func (m *mockStatusBus) Publish(sessionID string, status StatusInfo) {
	m.sessionID = sessionID
	m.status = status
}

type reentrantStatusBus struct {
	status   *SessionStatus
	observed StatusInfo
}

func (m *reentrantStatusBus) Publish(sessionID string, status StatusInfo) {
	m.observed = m.status.Get(sessionID)
}

func TestSessionStatus(t *testing.T) {
	bus := &mockStatusBus{}
	s := NewSessionStatus(bus)
	sessionID := "s1"

	t.Run("set and get status", func(t *testing.T) {
		status := StatusInfo{Type: StatusBusy, Message: "working"}
		s.Set(sessionID, status)

		got := s.Get(sessionID)
		assert.Equal(t, status, got)
		assert.Equal(t, sessionID, bus.sessionID)
		assert.Equal(t, status, bus.status)
	})

	t.Run("idle status removes entry", func(t *testing.T) {
		s.Set(sessionID, StatusInfo{Type: StatusIdle})
		got := s.Get(sessionID)
		assert.Equal(t, StatusIdle, got.Type)
		assert.NotContains(t, s.data, sessionID)
	})

	t.Run("publish happens after lock release", func(t *testing.T) {
		bus := &reentrantStatusBus{}
		statuses := NewSessionStatus(bus)
		bus.status = statuses

		done := make(chan struct{})
		go func() {
			statuses.Set("reentrant", StatusInfo{Type: StatusBusy, Message: "working"})
			close(done)
		}()

		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			require.Fail(t, "Set deadlocked while publishing status")
		}

		assert.Equal(t, StatusBusy, bus.observed.Type)
		assert.Equal(t, "working", bus.observed.Message)
	})
}

func TestBusStatusPublisher(t *testing.T) {
	bus := NewBus()
	pub := BusStatusPublisher{Bus: bus}

	ch := bus.Subscribe("session.status")
	idleCh := bus.Subscribe("session.idle")

	pub.Publish("s1", StatusInfo{Type: StatusBusy})

	ev := <-ch
	data, ok := ev.Data.(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "s1", data["sessionID"])

	pub.Publish("s1", StatusInfo{Type: StatusIdle})
	idleEv := <-idleCh
	idleData, ok := idleEv.Data.(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "s1", idleData["sessionID"])

	assert.NotPanics(t, func() {
		BusStatusPublisher{}.Publish("s1", StatusInfo{Type: StatusBusy})
	})
}
