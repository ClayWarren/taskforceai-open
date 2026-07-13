// Package circuitbreaker provides a circuit breaker implementation for protecting
// external API calls and handling transient failures gracefully.
package circuitbreaker

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// State represents the current state of the circuit breaker.
type State int

const (
	// StateClosed allows requests to pass through normally.
	StateClosed State = iota
	// StateOpen rejects all requests immediately.
	StateOpen
	// StateHalfOpen allows limited requests to test if the service has recovered.
	StateHalfOpen
)

func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// Common errors returned by the circuit breaker.
var (
	ErrCircuitOpen = errors.New("circuit breaker is open")
)

// Config contains the configuration for a circuit breaker.
type Config struct {
	// Name identifies this breaker in emitted telemetry.
	Name string
	// FailureThreshold is the number of consecutive failures before opening the circuit.
	// Default: 5
	FailureThreshold int
	// ResetTimeout is the duration to wait before transitioning from Open to HalfOpen.
	// Default: 60 seconds
	ResetTimeout time.Duration
	// SuccessThreshold is the number of successful requests needed in HalfOpen state
	// to transition back to Closed. Default: 2
	SuccessThreshold int
	// MaxHalfOpenRequests is the maximum number of concurrent requests allowed in HalfOpen state.
	// Default: 1
	MaxHalfOpenRequests int
	// IsTransient is a function that determines if an error is transient.
	// Transient errors are counted toward the failure threshold.
	// If nil, all errors are considered transient.
	IsTransient func(error) bool
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		FailureThreshold:    5,
		ResetTimeout:        60 * time.Second,
		SuccessThreshold:    2,
		MaxHalfOpenRequests: 1,
		IsTransient:         nil, // All errors considered transient by default
	}
}

// CircuitBreaker implements the circuit breaker pattern for external API calls.
type CircuitBreaker struct {
	config           Config
	state            State
	generation       uint64
	failureCount     int
	successCount     int
	halfOpenRequests int
	lastFailure      time.Time
	lastStateChange  time.Time
	mu               sync.RWMutex
}

type executionPermit struct {
	state      State
	generation uint64
}

var (
	telemetryOnce                sync.Once
	transitionCounter            metric.Int64Counter
	openRejectionCounter         metric.Int64Counter
	afterCanExecuteFastPathCheck func(*CircuitBreaker)
)

// New creates a new CircuitBreaker with the given configuration.
func New(config Config) *CircuitBreaker {
	initTelemetry()
	if config.FailureThreshold <= 0 {
		config.FailureThreshold = 5
	}
	if config.ResetTimeout <= 0 {
		config.ResetTimeout = 60 * time.Second
	}
	if config.SuccessThreshold <= 0 {
		config.SuccessThreshold = 2
	}
	if config.MaxHalfOpenRequests <= 0 {
		config.MaxHalfOpenRequests = 1
	}

	return &CircuitBreaker{
		config:          config,
		state:           StateClosed,
		lastStateChange: time.Now(),
	}
}

func initTelemetry() {
	telemetryOnce.Do(func() {
		meter := otel.Meter("resilience-circuitbreaker")
		transitionCounter, _ = meter.Int64Counter(
			"resilience.circuitbreaker.transition.total",
			metric.WithDescription("Number of circuit breaker state transitions"),
		)
		openRejectionCounter, _ = meter.Int64Counter(
			"resilience.circuitbreaker.open_rejection.total",
			metric.WithDescription("Number of requests rejected while circuit breaker is open"),
		)
	})
}

// NewWithDefaults creates a new CircuitBreaker with default configuration.
func NewWithDefaults() *CircuitBreaker {
	return New(DefaultConfig())
}

// Execute runs the given function through the circuit breaker.
// Returns ErrCircuitOpen if the circuit is open. A nil receiver also returns
// ErrCircuitOpen.
func (cb *CircuitBreaker) Execute(ctx context.Context, fn func() error) error {
	return cb.execute(ctx, fn, nil)
}

// ExecuteWithFallback runs the given function through the circuit breaker,
// and calls the fallback function if the circuit is open. A nil receiver runs
// the fallback when one is provided, otherwise it returns ErrCircuitOpen.
func (cb *CircuitBreaker) ExecuteWithFallback(ctx context.Context, fn func() error, fallback func() error) error {
	return cb.execute(ctx, fn, fallback)
}

func (cb *CircuitBreaker) execute(ctx context.Context, fn func() error, fallback func() error) error {
	if cb == nil {
		if fallback != nil {
			return fallback()
		}
		return ErrCircuitOpen
	}
	permit, ok := cb.admit(ctx)
	if !ok {
		cb.recordOpenRejection(ctx)
		if fallback != nil {
			return fallback()
		}
		return ErrCircuitOpen
	}

	return cb.executeAllowed(permit, fn)
}

func (cb *CircuitBreaker) executeAllowed(permit executionPermit, fn func() error) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			cb.recordTransientFailure(permit)
			panic(recovered)
		}
	}()

	err = fn()
	if err != nil {
		cb.recordFailure(err, permit)
	} else {
		cb.recordSuccess(permit)
	}

	return err
}

// State returns the current state of the circuit breaker.
func (cb *CircuitBreaker) State() State {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.getStateWithCheck()
}

// Stats returns statistics about the circuit breaker.
type Stats struct {
	State           State
	FailureCount    int
	SuccessCount    int
	LastFailure     time.Time
	LastStateChange time.Time
}

// Stats returns current statistics about the circuit breaker.
func (cb *CircuitBreaker) Stats() Stats {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return Stats{
		State:           cb.getStateWithCheck(),
		FailureCount:    cb.failureCount,
		SuccessCount:    cb.successCount,
		LastFailure:     cb.lastFailure,
		LastStateChange: cb.lastStateChange,
	}
}

// Reset resets the circuit breaker to its initial closed state.
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	previousGeneration := cb.generation
	cb.transitionLocked(context.Background(), StateClosed)
	cb.failureCount = 0
	cb.successCount = 0
	cb.halfOpenRequests = 0
	if cb.generation == previousGeneration {
		cb.generation++
	}
}

func (cb *CircuitBreaker) admit(ctx context.Context) (executionPermit, bool) {
	cb.mu.RLock()
	if cb.state == StateClosed {
		permit := executionPermit{state: StateClosed, generation: cb.generation}
		cb.mu.RUnlock()
		return permit, true
	}
	cb.mu.RUnlock()
	if afterCanExecuteFastPathCheck != nil {
		afterCanExecuteFastPathCheck(cb)
	}

	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return executionPermit{state: StateClosed, generation: cb.generation}, true
	case StateOpen:
		// Check if reset timeout has elapsed
		if time.Since(cb.lastStateChange) >= cb.config.ResetTimeout {
			cb.transitionLocked(ctx, StateHalfOpen)
			cb.successCount = 0
			cb.halfOpenRequests = 1
			return executionPermit{state: StateHalfOpen, generation: cb.generation}, true
		}
		return executionPermit{}, false
	case StateHalfOpen:
		if cb.halfOpenRequests < cb.config.MaxHalfOpenRequests {
			cb.halfOpenRequests++
			return executionPermit{state: StateHalfOpen, generation: cb.generation}, true
		}
		return executionPermit{}, false
	default:
		return executionPermit{}, false
	}
}

// getStateWithCheck returns the effective state, accounting for timeout transitions.
func (cb *CircuitBreaker) getStateWithCheck() State {
	if cb.state == StateOpen && time.Since(cb.lastStateChange) >= cb.config.ResetTimeout {
		return StateHalfOpen
	}
	return cb.state
}

// recordFailure records a failed request.
func (cb *CircuitBreaker) recordFailure(err error, permit executionPermit) {
	// Check if error is transient
	if cb.config.IsTransient != nil && !cb.config.IsTransient(err) {
		// Non-transient errors imply the downstream service is healthy but the request was invalid.
		// Record it as a success to decrement halfOpenRequests and potentially close the circuit.
		cb.recordSuccess(permit)
		return
	}

	cb.recordTransientFailure(permit)
}

func (cb *CircuitBreaker) recordTransientFailure(permit executionPermit) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if !cb.permitMatchesLocked(permit) {
		return
	}

	cb.failureCount++
	cb.lastFailure = time.Now()
	cb.successCount = 0

	switch permit.state {
	case StateClosed:
		if cb.failureCount >= cb.config.FailureThreshold {
			cb.transitionLocked(context.Background(), StateOpen)
		}
	case StateHalfOpen:
		cb.releaseHalfOpenRequestLocked()
		// Any failure in half-open immediately opens the circuit
		cb.transitionLocked(context.Background(), StateOpen)
		cb.failureCount = 0
	case StateOpen:
		return
	}
}

// recordSuccess records a successful request.
func (cb *CircuitBreaker) recordSuccess(permit executionPermit) {
	cb.mu.RLock()
	if permit.state == StateClosed &&
		cb.state == StateClosed &&
		cb.generation == permit.generation &&
		cb.failureCount == 0 {
		cb.mu.RUnlock()
		return
	}
	cb.mu.RUnlock()

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if !cb.permitMatchesLocked(permit) {
		return
	}

	cb.failureCount = 0

	if permit.state == StateHalfOpen {
		cb.releaseHalfOpenRequestLocked()
		cb.successCount++
		if cb.successCount >= cb.config.SuccessThreshold {
			cb.transitionLocked(context.Background(), StateClosed)
			cb.successCount = 0
		}
	}
}

func (cb *CircuitBreaker) permitMatchesLocked(permit executionPermit) bool {
	return cb.state == permit.state && cb.generation == permit.generation
}

func (cb *CircuitBreaker) releaseHalfOpenRequestLocked() {
	if cb.halfOpenRequests > 0 {
		cb.halfOpenRequests--
	}
}

func (cb *CircuitBreaker) transitionLocked(ctx context.Context, to State) {
	if cb.state == to {
		return
	}
	from := cb.state
	cb.state = to
	cb.generation++
	cb.lastStateChange = time.Now()
	if to != StateHalfOpen {
		cb.halfOpenRequests = 0
	}

	slog.Info("Circuit breaker state transition",
		"name", cb.config.Name,
		"from", from.String(),
		"to", to.String(),
		"failureCount", cb.failureCount,
		"successCount", cb.successCount)

	cb.recordTransition(ctx, from, to)
}

func (cb *CircuitBreaker) recordTransition(ctx context.Context, from State, to State) {
	if transitionCounter == nil {
		return
	}
	name := cb.config.Name
	if name == "" {
		name = "unnamed"
	}
	transitionCounter.Add(ctx, 1, metric.WithAttributes(
		attribute.String("breaker_name", name),
		attribute.String("from_state", from.String()),
		attribute.String("to_state", to.String()),
	))
}

func (cb *CircuitBreaker) recordOpenRejection(ctx context.Context) {
	if openRejectionCounter == nil {
		return
	}
	name := cb.config.Name
	if name == "" {
		name = "unnamed"
	}
	openRejectionCounter.Add(ctx, 1, metric.WithAttributes(
		attribute.String("breaker_name", name),
	))
}
