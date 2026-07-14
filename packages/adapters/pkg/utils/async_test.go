package utils

import (
	"errors"
	"testing"
	"time"
)

func TestAsync(t *testing.T) {
	t.Run("Sleep", func(t *testing.T) {
		start := time.Now()
		Sleep(10)
		duration := time.Since(start)
		if duration < 10*time.Millisecond {
			t.Errorf("slept for %v, expected at least 10ms", duration)
		}
	})

	t.Run("Retry - Success", func(t *testing.T) {
		calls := 0
		fn := func() (int, error) {
			calls++
			if calls < 3 {
				return 0, errors.New("fail")
			}
			return 42, nil
		}

		res, err := Retry(fn, 5, 1*time.Millisecond, 1.0)
		if err != nil {
			t.Errorf("expected success, got error %v", err)
		}
		if res != 42 {
			t.Errorf("expected 42, got %d", res)
		}
		if calls != 3 {
			t.Errorf("expected 3 calls, got %d", calls)
		}
	})

	t.Run("Retry - Exhausted", func(t *testing.T) {
		calls := 0
		fn := func() (int, error) {
			calls++
			return 0, errors.New("permanent fail")
		}

		_, err := Retry(fn, 2, 1*time.Millisecond, 1.0)
		if err == nil {
			t.Error("expected error, got nil")
		}
		if calls != 3 { // initial + 2 retries
			t.Errorf("expected 3 calls, got %d", calls)
		}
	})

	t.Run("Retry - NegativeRetriesUsesSingleAttempt", func(t *testing.T) {
		calls := 0
		fn := func() (int, error) {
			calls++
			return 0, errors.New("fail")
		}

		_, err := Retry(fn, -1, 1*time.Millisecond, 2)
		if err == nil {
			t.Fatal("expected error")
		}
		if calls != 1 {
			t.Errorf("expected 1 call, got %d", calls)
		}
	})

	t.Run("Retry - BackoffFactorGreaterThanOne", func(t *testing.T) {
		calls := 0
		fn := func() (int, error) {
			calls++
			if calls == 1 {
				return 0, errors.New("fail")
			}
			return 7, nil
		}

		got, err := Retry(fn, 2, 1*time.Millisecond, 2)
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if got != 7 || calls != 2 {
			t.Fatalf("got=%d calls=%d, want 7 and 2", got, calls)
		}
	})

	t.Run("Retry - MaxIntRetriesIsCapped", func(t *testing.T) {
		maxInt := int(^uint(0) >> 1)
		calls := 0
		got, err := Retry(func() (int, error) {
			calls++
			return 9, nil
		}, maxInt, 0, 1)
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if got != 9 || calls != 1 {
			t.Fatalf("got=%d calls=%d, want 9 and 1", got, calls)
		}
	})

	t.Run("Retry - NonPositiveMaxIntervalStopsGrowth", func(t *testing.T) {
		calls := 0
		got, err := Retry(func() (int, error) {
			calls++
			return 10, nil
		}, 2, -time.Millisecond, 2)
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if got != 10 {
			t.Fatalf("got %d, want 10", got)
		}
	})
}
