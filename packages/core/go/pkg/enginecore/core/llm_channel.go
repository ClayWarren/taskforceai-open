package core

import (
	"errors"
	"sync"
	"time"
)

// ChannelLLMStream is a push-based LLMStream for external adapters.
type ChannelLLMStream struct {
	mu          sync.Mutex
	events      []LLMEvent
	closed      bool
	cond        *sync.Cond
	waitTimeout time.Duration
}

func NewChannelLLMStream() *ChannelLLMStream {
	s := &ChannelLLMStream{waitTimeout: DefaultLLMStreamWaitTimeout}
	s.cond = sync.NewCond(&s.mu)
	return s
}

func NewChannelLLMStreamWithTimeout(timeout time.Duration) *ChannelLLMStream {
	s := &ChannelLLMStream{waitTimeout: timeout}
	s.cond = sync.NewCond(&s.mu)
	return s
}

func (s *ChannelLLMStream) SetWaitTimeout(timeout time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.waitTimeout = timeout
}

func (s *ChannelLLMStream) Push(ev LLMEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.events = append(s.events, ev)
	s.cond.Signal()
}

func (s *ChannelLLMStream) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.cond.Broadcast()
}

func (s *ChannelLLMStream) Next() (LLMEvent, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.waitTimeout <= 0 {
		for len(s.events) == 0 && !s.closed {
			s.cond.Wait()
		}
		if len(s.events) == 0 {
			return LLMEvent{}, false, nil
		}
		ev := s.events[0]
		s.events = s.events[1:]
		return ev, true, nil
	}

	// A single time.AfterFunc fires exactly once. If cond.Wait() returns early due to
	// a spurious wakeup before the deadline, the timer has already fired and will never
	// fire again, leaving the goroutine blocked indefinitely. Re-arm the timer on each
	// loop iteration with the remaining time to guarantee the wakeup fires.
	deadline := time.Now().Add(s.waitTimeout)
	for len(s.events) == 0 && !s.closed {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return LLMEvent{}, false, ErrLLMStreamTimeout
		}
		timer := time.AfterFunc(remaining, func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.cond.Broadcast()
		})
		s.cond.Wait()
		timer.Stop()
	}
	if len(s.events) == 0 {
		return LLMEvent{}, false, nil
	}
	ev := s.events[0]
	s.events = s.events[1:]
	return ev, true, nil
}

var ErrLLMStreamTimeout = errors.New("llm stream timeout waiting for events")

const DefaultLLMStreamWaitTimeout = 5 * time.Minute
