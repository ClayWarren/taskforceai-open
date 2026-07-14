// Package runtimevalue provides synchronized, replaceable runtime dependencies
// for core packages without exposing their storage mechanics publicly.
package runtimevalue

import "sync"

// Slot stores a runtime dependency and restores its fallback for nil values.
type Slot[T any] struct {
	mu       sync.RWMutex
	value    T
	fallback T
}

// New returns a slot initialized with fallback.
func New[T any](fallback T) *Slot[T] {
	return &Slot[T]{value: fallback, fallback: fallback}
}

// Set replaces the current value and returns a function that restores it.
func (s *Slot[T]) Set(value T) func() {
	if any(value) == nil {
		value = s.fallback
	}
	s.mu.Lock()
	previous := s.value
	s.value = value
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		s.value = previous
		s.mu.Unlock()
	}
}

// Current returns the installed value, or the fallback if it is nil.
func (s *Slot[T]) Current() T {
	s.mu.RLock()
	value := s.value
	s.mu.RUnlock()
	if any(value) == nil {
		return s.fallback
	}
	return value
}
