package retry

import (
	"context"
	"errors"
	"testing"
	"time"

	backoff "github.com/cenkalti/backoff/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDo_Success(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	calls := 0

	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		return nil
	})

	require.NoError(t, err)
	assert.Equal(t, 1, calls)
}

func TestDo_RetryThenSuccess(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	cfg.InitialInterval = 1 * time.Millisecond // Fast for test
	calls := 0

	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		if calls < 2 {
			return errors.New("fail")
		}
		return nil
	})

	require.NoError(t, err)
	assert.Equal(t, 2, calls)
}

func TestDo_MaxAttemptsReached(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	cfg.MaxAttempts = 2
	cfg.InitialInterval = 1 * time.Millisecond
	calls := 0

	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		return errors.New("fail")
	})

	require.Error(t, err)
	assert.Equal(t, "fail", err.Error())
	assert.Equal(t, 2, calls)
}

func TestDo_UsesDefaultsForInvalidConfig(t *testing.T) {
	ctx := context.Background()
	cfg := Config{
		MaxAttempts:     -1,
		InitialInterval: time.Nanosecond,
		Multiplier:      1,
		MaxJitter:       -1,
	}
	calls := 0

	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		return errors.New("fail")
	})

	require.Error(t, err)
	assert.Equal(t, 3, calls)
}

func TestApplyDefaults(t *testing.T) {
	cfg := applyDefaults(Config{
		MaxAttempts:     -1,
		InitialInterval: -1,
		MaxInterval:     -1,
		Multiplier:      1,
	})

	assert.Equal(t, 3, cfg.MaxAttempts)
	assert.Equal(t, time.Second, cfg.InitialInterval)
	assert.Equal(t, 30*time.Second, cfg.MaxInterval)
	assert.Equal(t, 2.0, cfg.Multiplier)
	assert.Equal(t, 100*time.Millisecond, cfg.MaxJitter)
}

func TestApplyDefaultsCapsMaxAttempts(t *testing.T) {
	cfg := applyDefaults(Config{
		MaxAttempts: maxRetryAttempts + 1,
	})

	assert.Equal(t, maxRetryAttempts, cfg.MaxAttempts)
}

func TestDo_ContextCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := DefaultConfig()
	cfg.InitialInterval = 50 * time.Millisecond

	// Cancel context immediately after first call
	err := Do(ctx, cfg, func(ctx context.Context) error {
		cancel()
		return errors.New("fail")
	})

	require.Error(t, err)
	assert.Equal(t, context.Canceled, err)
}

func TestDo_ContextCanceledBeforeCallSkipsOperation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	calls := 0
	err := Do(ctx, DefaultConfig(), func(ctx context.Context) error {
		calls++
		return nil
	})

	assert.Equal(t, context.Canceled, err)
	assert.Equal(t, 0, calls)
}

func TestDo_ContextDeadlineExceeded(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Millisecond))
	defer cancel()

	err := Do(ctx, DefaultConfig(), func(ctx context.Context) error {
		return errors.New("fail")
	})

	assert.Equal(t, context.DeadlineExceeded, err)
}

func TestDo_NotRetryable(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	calls := 0

	fatalErr := errors.New("fatal")

	cfg.Retryable = func(err error) bool {
		return !errors.Is(err, fatalErr)
	}

	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		return fatalErr
	})

	assert.Equal(t, fatalErr, err)
	assert.Equal(t, 1, calls)
}

func TestDo_NotRetryableOnFinalAttemptReturnsOriginalError(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	cfg.MaxAttempts = 2
	cfg.InitialInterval = time.Nanosecond
	cfg.MaxJitter = -1

	transientErr := errors.New("transient")
	fatalErr := errors.New("fatal")
	calls := 0

	cfg.Retryable = func(err error) bool {
		return !errors.Is(err, fatalErr)
	}

	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		if calls == 1 {
			return transientErr
		}
		return fatalErr
	})

	assert.Equal(t, fatalErr, err)
	assert.Equal(t, 2, calls)
	var permanent *backoff.PermanentError
	assert.NotErrorAs(t, err, &permanent)
}

func TestDo_UsesMaxIntervalAndJitter(t *testing.T) {
	ctx := context.Background()
	cfg := DefaultConfig()
	cfg.MaxAttempts = 2
	cfg.InitialInterval = time.Millisecond
	cfg.MaxInterval = time.Millisecond
	cfg.MaxJitter = time.Millisecond

	calls := 0
	err := Do(ctx, cfg, func(ctx context.Context) error {
		calls++
		return errors.New("fail")
	})

	require.Error(t, err)
	assert.Equal(t, 2, calls)
}

func TestJitterBackOff(t *testing.T) {
	base := &fixedBackOff{delays: []time.Duration{time.Millisecond, -1}}
	jitter := &jitterBackOff{base: base, maxJitter: time.Millisecond}

	delay := jitter.NextBackOff()
	assert.GreaterOrEqual(t, delay, time.Millisecond)
	assert.Less(t, delay, 2*time.Millisecond)

	assert.Equal(t, time.Duration(-1), jitter.NextBackOff())

	jitter.Reset()
	assert.True(t, base.reset)
}

type fixedBackOff struct {
	delays []time.Duration
	reset  bool
}

func (f *fixedBackOff) Reset() {
	f.reset = true
}

func (f *fixedBackOff) NextBackOff() time.Duration {
	next := f.delays[0]
	f.delays = f.delays[1:]
	return next
}

func BenchmarkDoSuccess(b *testing.B) {
	ctx := context.Background()
	cfg := DefaultConfig()

	b.ReportAllocs()
	for b.Loop() {
		err := Do(ctx, cfg, func(ctx context.Context) error {
			return nil
		})
		if err != nil {
			b.Fatalf("expected success, got %v", err)
		}
	}
}
