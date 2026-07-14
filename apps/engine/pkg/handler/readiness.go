package handler

import "sync"

var engineReadyState = struct {
	mu     sync.RWMutex
	ready  bool
	reason string
}{
	ready:  false,
	reason: "startup",
}

// SetEngineReadiness sets the readiness state of the engine.
func SetEngineReadiness(ready bool, reason string) {
	engineReadyState.mu.Lock()
	defer engineReadyState.mu.Unlock()
	engineReadyState.ready = ready
	engineReadyState.reason = reason
}

// GetEngineReadiness returns the current readiness state of the engine.
func GetEngineReadiness() (bool, string) {
	engineReadyState.mu.RLock()
	defer engineReadyState.mu.RUnlock()
	return engineReadyState.ready, engineReadyState.reason
}
