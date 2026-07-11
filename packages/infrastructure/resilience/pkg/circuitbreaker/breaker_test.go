package circuitbreaker

import (
	"context"
	"errors"
	"testing"
	"time"
)

var errTest = errors.New("test error")

func TestCircuitBreaker_InitialState(t *testing.T) {
	cb := NewWithDefaults()
	if cb.State() != StateClosed {
		t.Errorf("expected initial state to be Closed, got %v", cb.State())
	}
}

func TestCircuitBreaker_OpensAfterFailureThreshold(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 3,
		ResetTimeout:     time.Minute,
		SuccessThreshold: 2,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }

	// First 2 failures should not open the circuit
	for i := range 2 {
		_ = cb.Execute(ctx, failingFn)
		if cb.State() != StateClosed {
			t.Errorf("circuit should remain closed after %d failures", i+1)
		}
	}

	// Third failure should open the circuit
	_ = cb.Execute(ctx, failingFn)
	if cb.State() != StateOpen {
		t.Errorf("circuit should be open after %d failures, got %v", 3, cb.State())
	}
}

func TestCircuitBreaker_RejectsWhenOpen(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }

	// Open the circuit
	_ = cb.Execute(ctx, failingFn)

	// Next execution should be rejected
	err := cb.Execute(ctx, func() error { return nil })
	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreaker_NilExecuteReturnsCircuitOpen(t *testing.T) {
	var cb *CircuitBreaker

	err := cb.Execute(context.Background(), func() error {
		t.Fatal("operation should not run for nil circuit breaker")
		return nil
	})

	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreaker_UsesDefaultsForInvalidConfig(t *testing.T) {
	cb := New(Config{})

	if cb.config.FailureThreshold != 5 {
		t.Errorf("expected default failure threshold 5, got %d", cb.config.FailureThreshold)
	}
	if cb.config.ResetTimeout != 60*time.Second {
		t.Errorf("expected default reset timeout 60s, got %v", cb.config.ResetTimeout)
	}
	if cb.config.SuccessThreshold != 2 {
		t.Errorf("expected default success threshold 2, got %d", cb.config.SuccessThreshold)
	}
	if cb.config.MaxHalfOpenRequests != 1 {
		t.Errorf("expected default max half-open requests 1, got %d", cb.config.MaxHalfOpenRequests)
	}
}

func TestCircuitBreaker_TransitionsToHalfOpen(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     10 * time.Millisecond,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }

	// Open the circuit
	_ = cb.Execute(ctx, failingFn)

	// Wait for reset timeout
	time.Sleep(20 * time.Millisecond)

	// State should be half-open (or transition to it on next check)
	if cb.State() != StateHalfOpen {
		t.Errorf("expected state to be HalfOpen after reset timeout, got %v", cb.State())
	}
}

func TestCircuitBreaker_LimitsHalfOpenRequests(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    2,
		MaxHalfOpenRequests: 1,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error)

	go func() {
		done <- cb.Execute(ctx, func() error {
			close(started)
			<-release
			return nil
		})
	}()

	<-started
	err := cb.Execute(ctx, func() error { return nil })
	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected concurrent half-open request to be rejected, got %v", err)
	}

	close(release)
	if err := <-done; err != nil {
		t.Errorf("expected in-flight half-open request to succeed, got %v", err)
	}
}

func TestCircuitBreaker_LimitsConfiguredHalfOpenRequests(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    3,
		MaxHalfOpenRequests: 2,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	started := make(chan struct{}, 2)
	release := make(chan struct{})
	done := make(chan error, 2)

	for range 2 {
		go func() {
			done <- cb.Execute(ctx, func() error {
				started <- struct{}{}
				<-release
				return nil
			})
		}()
	}

	<-started
	<-started

	err := cb.Execute(ctx, func() error { return nil })
	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected third concurrent half-open request to be rejected, got %v", err)
	}

	close(release)
	for range 2 {
		if err := <-done; err != nil {
			t.Errorf("expected in-flight half-open request to succeed, got %v", err)
		}
	}
}

func TestCircuitBreaker_StaleClosedSuccessDoesNotReleaseHalfOpenProbe(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    2,
		MaxHalfOpenRequests: 1,
	})

	ctx := context.Background()
	closedStarted := make(chan struct{})
	releaseClosed := make(chan struct{})
	closedDone := make(chan error, 1)

	go func() {
		closedDone <- cb.Execute(ctx, func() error {
			close(closedStarted)
			<-releaseClosed
			return nil
		})
	}()

	<-closedStarted
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	probeStarted := make(chan struct{})
	releaseProbe := make(chan struct{})
	probeDone := make(chan error, 1)

	go func() {
		probeDone <- cb.Execute(ctx, func() error {
			close(probeStarted)
			<-releaseProbe
			return nil
		})
	}()

	<-probeStarted
	close(releaseClosed)
	if err := <-closedDone; err != nil {
		t.Fatalf("expected stale closed request to finish successfully, got %v", err)
	}

	cb.mu.RLock()
	halfOpenRequests := cb.halfOpenRequests
	successCount := cb.successCount
	cb.mu.RUnlock()
	if halfOpenRequests != 1 {
		t.Fatalf("expected stale closed success to leave probe slot occupied, got %d", halfOpenRequests)
	}
	if successCount != 0 {
		t.Fatalf("expected stale closed success not to count as recovery, got %d", successCount)
	}

	ran := false
	err := cb.Execute(ctx, func() error {
		ran = true
		return nil
	})
	if ran {
		t.Fatal("stale closed success released a half-open slot")
	}
	if !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("expected second half-open request to be rejected, got %v", err)
	}

	close(releaseProbe)
	if err := <-probeDone; err != nil {
		t.Fatalf("expected actual half-open probe to succeed, got %v", err)
	}
	if cb.State() != StateHalfOpen {
		t.Fatalf("expected breaker to remain half-open after one actual recovery probe, got %v", cb.State())
	}
}

func TestCircuitBreaker_StaleClosedFailureDoesNotReopenHalfOpen(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    2,
		MaxHalfOpenRequests: 1,
	})

	ctx := context.Background()
	closedStarted := make(chan struct{})
	releaseClosedFailure := make(chan struct{})
	closedDone := make(chan error, 1)

	go func() {
		closedDone <- cb.Execute(ctx, func() error {
			close(closedStarted)
			<-releaseClosedFailure
			return errTest
		})
	}()

	<-closedStarted
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	err := cb.Execute(ctx, func() error {
		close(releaseClosedFailure)
		if staleErr := <-closedDone; !errors.Is(staleErr, errTest) {
			t.Fatalf("expected stale closed failure to return original error, got %v", staleErr)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected half-open probe to succeed, got %v", err)
	}
	if cb.State() != StateHalfOpen {
		t.Fatalf("expected stale closed failure not to reopen breaker, got %v", cb.State())
	}
}

func TestCircuitBreaker_HalfOpenFailureClearsProbeBookkeeping(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    3,
		MaxHalfOpenRequests: 2,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	started := make(chan struct{}, 2)
	releaseFailure := make(chan struct{})
	releaseSuccess := make(chan struct{})
	failDone := make(chan error, 1)
	successDone := make(chan error, 1)

	go func() {
		failDone <- cb.Execute(ctx, func() error {
			started <- struct{}{}
			<-releaseFailure
			return errTest
		})
	}()
	go func() {
		successDone <- cb.Execute(ctx, func() error {
			started <- struct{}{}
			<-releaseSuccess
			return nil
		})
	}()

	<-started
	<-started
	close(releaseFailure)
	if err := <-failDone; !errors.Is(err, errTest) {
		t.Errorf("expected failing probe error, got %v", err)
	}
	if cb.State() != StateOpen {
		t.Errorf("expected half-open failure to reopen circuit, got %v", cb.State())
	}
	if cb.halfOpenRequests != 0 {
		t.Errorf("expected failed half-open transition to clear in-flight probes, got %d", cb.halfOpenRequests)
	}

	close(releaseSuccess)
	if err := <-successDone; err != nil {
		t.Errorf("expected already-started success probe to return nil, got %v", err)
	}
}

func TestCircuitBreaker_HalfOpenPanicClearsProbeBookkeeping(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    1,
		MaxHalfOpenRequests: 1,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	func() {
		defer func() {
			if recovered := recover(); recovered != "boom" {
				t.Fatalf("expected panic to propagate, got %v", recovered)
			}
		}()
		_ = cb.Execute(ctx, func() error {
			panic("boom")
		})
	}()

	if cb.State() != StateOpen {
		t.Errorf("expected half-open panic to reopen circuit, got %v", cb.State())
	}
	if cb.halfOpenRequests != 0 {
		t.Errorf("expected half-open panic to clear in-flight probe, got %d", cb.halfOpenRequests)
	}
}

func TestCircuitBreaker_ClosesAfterSuccessInHalfOpen(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     10 * time.Millisecond,
		SuccessThreshold: 2,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }
	successFn := func() error { return nil }

	// Open the circuit
	_ = cb.Execute(ctx, failingFn)

	// Wait for reset timeout
	time.Sleep(20 * time.Millisecond)

	// First success in half-open
	_ = cb.Execute(ctx, successFn)
	if cb.State() != StateHalfOpen {
		t.Errorf("expected state to remain HalfOpen after 1 success, got %v", cb.State())
	}

	// Second success should close the circuit
	_ = cb.Execute(ctx, successFn)
	if cb.State() != StateClosed {
		t.Errorf("expected state to be Closed after 2 successes, got %v", cb.State())
	}
}

func TestCircuitBreaker_ReopensOnFailureInHalfOpen(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     10 * time.Millisecond,
		SuccessThreshold: 2,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }

	// Open the circuit
	_ = cb.Execute(ctx, failingFn)

	// Wait for reset timeout
	time.Sleep(20 * time.Millisecond)

	// Verify half-open
	if cb.State() != StateHalfOpen {
		t.Fatalf("expected HalfOpen state, got %v", cb.State())
	}

	// Failure in half-open should reopen
	_ = cb.Execute(ctx, failingFn)
	if cb.State() != StateOpen {
		t.Errorf("expected state to be Open after failure in HalfOpen, got %v", cb.State())
	}
}

func TestCircuitBreaker_NonTransientErrorInHalfOpenCountsAsSuccess(t *testing.T) {
	permanentErr := errors.New("permanent")

	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    1,
		MaxHalfOpenRequests: 1,
		IsTransient: func(err error) bool {
			return !errors.Is(err, permanentErr)
		},
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	err := cb.Execute(ctx, func() error { return permanentErr })
	if !errors.Is(err, permanentErr) {
		t.Errorf("expected permanent error to be returned, got %v", err)
	}
	if cb.State() != StateClosed {
		t.Errorf("expected non-transient half-open error to close circuit, got %v", cb.State())
	}
}

func TestCircuitBreaker_SuccessResetsFailureCount(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 3,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }
	successFn := func() error { return nil }

	// Two failures
	_ = cb.Execute(ctx, failingFn)
	_ = cb.Execute(ctx, failingFn)

	// Success should reset
	_ = cb.Execute(ctx, successFn)

	// Two more failures should not open (reset to 2 not 4)
	_ = cb.Execute(ctx, failingFn)
	_ = cb.Execute(ctx, failingFn)
	if cb.State() != StateClosed {
		t.Errorf("circuit should remain closed, got %v", cb.State())
	}
}

func TestCircuitBreaker_IsTransientFilter(t *testing.T) {
	permanentErr := errors.New("permanent error")
	transientErr := errors.New("transient error")

	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
		IsTransient: func(err error) bool {
			return errors.Is(err, transientErr)
		},
	})

	ctx := context.Background()

	// Permanent error should not count toward threshold
	_ = cb.Execute(ctx, func() error { return permanentErr })
	if cb.State() != StateClosed {
		t.Errorf("permanent error should not open circuit, got state %v", cb.State())
	}

	// Transient error should open circuit
	_ = cb.Execute(ctx, func() error { return transientErr })
	if cb.State() != StateOpen {
		t.Errorf("transient error should open circuit, got state %v", cb.State())
	}
}

func TestCircuitBreaker_ExecuteWithFallback(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }
	fallbackCalled := false
	fallbackFn := func() error {
		fallbackCalled = true
		return nil
	}

	// Open the circuit
	_ = cb.Execute(ctx, failingFn)

	// Execute with fallback
	err := cb.ExecuteWithFallback(ctx, failingFn, fallbackFn)
	if err != nil {
		t.Errorf("expected fallback to succeed, got error: %v", err)
	}
	if !fallbackCalled {
		t.Error("expected fallback to be called")
	}
}

func TestCircuitBreaker_ExecuteWithFallbackUsesPrimaryWhenClosed(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	primaryCalled := false
	err := cb.ExecuteWithFallback(context.Background(), func() error {
		primaryCalled = true
		return nil
	}, func() error {
		t.Fatal("fallback should not run while circuit is closed")
		return nil
	})

	if err != nil {
		t.Errorf("expected primary operation to succeed, got %v", err)
	}
	if !primaryCalled {
		t.Error("expected primary operation to run")
	}
}

func TestCircuitBreaker_NilExecuteWithFallback(t *testing.T) {
	var cb *CircuitBreaker
	fallbackErr := errors.New("fallback error")

	err := cb.ExecuteWithFallback(context.Background(), func() error {
		t.Fatal("operation should not run for nil circuit breaker")
		return nil
	}, func() error {
		return fallbackErr
	})

	if !errors.Is(err, fallbackErr) {
		t.Errorf("expected fallback error, got %v", err)
	}
}

func TestCircuitBreaker_NilExecuteWithFallbackWithoutFallback(t *testing.T) {
	var cb *CircuitBreaker

	err := cb.ExecuteWithFallback(context.Background(), func() error {
		t.Fatal("operation should not run for nil circuit breaker")
		return nil
	}, nil)

	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreaker_ExecuteWithFallbackReturnsCircuitOpenWithoutFallback(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })

	err := cb.ExecuteWithFallback(ctx, func() error { return nil }, nil)
	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen without fallback, got %v", err)
	}
}

func TestCircuitBreaker_ExecuteWithFallbackRecordsSuccessWhenClosed(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 2,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })

	err := cb.ExecuteWithFallback(ctx, func() error { return nil }, func() error {
		t.Fatal("fallback should not run while circuit is closed")
		return nil
	})
	if err != nil {
		t.Errorf("expected primary operation to succeed, got %v", err)
	}
	if stats := cb.Stats(); stats.FailureCount != 0 {
		t.Errorf("expected successful primary operation to reset failures, got %d", stats.FailureCount)
	}
}

func TestCircuitBreaker_Reset(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 1,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }

	// Open the circuit
	_ = cb.Execute(ctx, failingFn)
	if cb.State() != StateOpen {
		t.Fatalf("circuit should be open")
	}

	// Reset
	cb.Reset()
	if cb.State() != StateClosed {
		t.Errorf("expected state to be Closed after reset, got %v", cb.State())
	}

	// Should be able to execute again
	err := cb.Execute(ctx, func() error { return nil })
	if err != nil {
		t.Errorf("expected execution to succeed after reset, got %v", err)
	}
}

func TestCircuitBreaker_ResetWhenAlreadyClosedIsNoop(t *testing.T) {
	cb := NewWithDefaults()
	before := cb.Stats()

	cb.Reset()

	after := cb.Stats()
	if after.State != StateClosed {
		t.Errorf("expected reset to leave closed circuit closed, got %v", after.State)
	}
	if !after.LastStateChange.Equal(before.LastStateChange) {
		t.Errorf("expected no state transition when resetting closed circuit")
	}
}

func TestCircuitBreaker_ResetClearsHalfOpenBookkeeping(t *testing.T) {
	cb := New(Config{
		FailureThreshold:    1,
		ResetTimeout:        10 * time.Millisecond,
		SuccessThreshold:    2,
		MaxHalfOpenRequests: 1,
	})

	ctx := context.Background()
	_ = cb.Execute(ctx, func() error { return errTest })
	time.Sleep(20 * time.Millisecond)

	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)

	go func() {
		done <- cb.Execute(ctx, func() error {
			close(started)
			<-release
			return nil
		})
	}()

	<-started
	cb.Reset()
	if cb.State() != StateClosed {
		t.Errorf("expected reset to close circuit, got %v", cb.State())
	}
	if cb.halfOpenRequests != 0 {
		t.Errorf("expected reset to clear half-open probes, got %d", cb.halfOpenRequests)
	}

	close(release)
	if err := <-done; err != nil {
		t.Errorf("expected in-flight operation to finish successfully after reset, got %v", err)
	}
}

func TestCircuitBreaker_Stats(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 3,
		ResetTimeout:     time.Hour,
		SuccessThreshold: 1,
	})

	ctx := context.Background()
	failingFn := func() error { return errTest }

	// Generate some failures
	_ = cb.Execute(ctx, failingFn)
	_ = cb.Execute(ctx, failingFn)

	stats := cb.Stats()
	if stats.State != StateClosed {
		t.Errorf("expected Closed state, got %v", stats.State)
	}
	if stats.FailureCount != 2 {
		t.Errorf("expected failure count 2, got %d", stats.FailureCount)
	}
	if stats.LastFailure.IsZero() {
		t.Error("expected LastFailure to be set")
	}
}

func TestCircuitBreaker_UnknownStateRejectsExecution(t *testing.T) {
	cb := NewWithDefaults()
	cb.mu.Lock()
	cb.state = State(99)
	cb.mu.Unlock()

	err := cb.Execute(context.Background(), func() error {
		t.Fatal("operation should not run for unknown circuit breaker state")
		return nil
	})

	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreaker_CanExecuteHandlesClosedStateAfterFastPath(t *testing.T) {
	cb := NewWithDefaults()
	cb.mu.Lock()
	cb.state = StateOpen
	cb.mu.Unlock()

	originalHook := afterCanExecuteFastPathCheck
	t.Cleanup(func() {
		afterCanExecuteFastPathCheck = originalHook
	})
	afterCanExecuteFastPathCheck = func(cb *CircuitBreaker) {
		cb.mu.Lock()
		cb.state = StateClosed
		cb.mu.Unlock()
	}

	if !cb.canExecute(context.Background()) {
		t.Fatal("expected canExecute to allow state that closes after fast path check")
	}
}

func TestCircuitBreaker_NilTelemetryCountersAreNoops(t *testing.T) {
	cb := New(Config{Name: ""})

	originalTransitionCounter := transitionCounter
	originalOpenRejectionCounter := openRejectionCounter
	t.Cleanup(func() {
		transitionCounter = originalTransitionCounter
		openRejectionCounter = originalOpenRejectionCounter
	})

	transitionCounter = nil
	openRejectionCounter = nil

	cb.recordTransition(context.Background(), StateClosed, StateOpen)
	cb.recordOpenRejection(context.Background())
}

func TestCircuitBreaker_StateString(t *testing.T) {
	tests := []struct {
		state    State
		expected string
	}{
		{StateClosed, "closed"},
		{StateOpen, "open"},
		{StateHalfOpen, "half-open"},
		{State(99), "unknown"},
	}

	for _, tt := range tests {
		if tt.state.String() != tt.expected {
			t.Errorf("State(%d).String() = %q, expected %q", tt.state, tt.state.String(), tt.expected)
		}
	}
}

func BenchmarkCircuitBreakerExecuteSuccess(b *testing.B) {
	cb := NewWithDefaults()
	ctx := context.Background()

	b.ReportAllocs()
	for b.Loop() {
		err := cb.Execute(ctx, func() error {
			return nil
		})
		if err != nil {
			b.Fatalf("expected success, got %v", err)
		}
	}
}

// TestCircuitBreaker_RecordTransientFailureWhilePermitOpen exercises the
// defensive StateOpen branch of recordTransientFailure. A permit is never
// issued in StateOpen through admit(), so this case is only reachable via a
// directly-constructed permit whose captured state matches an already-open
// breaker. It must record the failure but leave the open state untouched.
func TestCircuitBreaker_RecordTransientFailureWhilePermitOpen(t *testing.T) {
	cb := New(Config{
		FailureThreshold: 3,
		ResetTimeout:     time.Minute,
	})
	cb.mu.Lock()
	cb.state = StateOpen
	permit := executionPermit{state: StateOpen, generation: cb.generation}
	cb.mu.Unlock()

	cb.recordTransientFailure(permit)

	cb.mu.RLock()
	defer cb.mu.RUnlock()
	if cb.state != StateOpen {
		t.Fatalf("expected state to remain Open, got %v", cb.state)
	}
	if cb.failureCount != 1 {
		t.Fatalf("expected failureCount to increment to 1, got %d", cb.failureCount)
	}
}

func BenchmarkCircuitBreakerStateClosed(b *testing.B) {
	cb := NewWithDefaults()

	b.ReportAllocs()
	for b.Loop() {
		if cb.State() != StateClosed {
			b.Fatal("expected closed state")
		}
	}
}
