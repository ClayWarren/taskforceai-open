package retry

import (
	"context"
	"errors"
	"log/slog"
	"math/rand"
	"time"

	backoff "github.com/cenkalti/backoff/v5"
)

const maxRetryAttempts = 1_000

// Config defines the parameters for the retry mechanism.
type Config struct {
	// MaxAttempts is the maximum number of times to try the operation.
	// Default: 3
	MaxAttempts int

	// InitialInterval is the first delay before retrying.
	// Default: 1 second
	InitialInterval time.Duration

	// MaxInterval is the upper bound for the backoff delay.
	// Default: 30 seconds
	MaxInterval time.Duration

	// Multiplier is the factor by which the interval increases each retry.
	// Default: 2.0
	Multiplier float64

	// MaxJitter is the maximum random jitter to add to the delay.
	// Default: 100 milliseconds
	// Set a negative duration to disable jitter.
	MaxJitter time.Duration

	// Retryable checks if an error should trigger a retry.
	// If nil, all errors are retried.
	Retryable func(error) bool
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		MaxAttempts:     3,
		InitialInterval: 1 * time.Second,
		MaxInterval:     30 * time.Second,
		Multiplier:      2.0,
		MaxJitter:       100 * time.Millisecond,
		Retryable:       nil,
	}
}

// Do executes the given function with retries based on the configuration.
func Do(ctx context.Context, cfg Config, fn func(ctx context.Context) error) error {
	cfg = applyDefaults(cfg)

	if ctx.Err() != nil {
		return ctx.Err()
	}
	firstErr := fn(ctx)
	if firstErr == nil {
		return nil
	}

	return retryAfterFailure(ctx, cfg, fn, firstErr)
}

func retryAfterFailure(ctx context.Context, cfg Config, fn func(ctx context.Context) error, firstErr error) error {
	exponential := backoff.NewExponentialBackOff()
	exponential.InitialInterval = cfg.InitialInterval
	exponential.RandomizationFactor = 0
	exponential.Multiplier = cfg.Multiplier
	exponential.MaxInterval = cfg.MaxInterval

	retryBackoff := backoff.BackOff(exponential)
	if cfg.MaxJitter > 0 {
		retryBackoff = &jitterBackOff{
			base:      exponential,
			maxJitter: cfg.MaxJitter,
		}
	}

	attempt := 1
	useFirstErr := true
	_, err := backoff.Retry(
		ctx,
		func() (struct{}, error) {
			if ctx.Err() != nil {
				return struct{}{}, ctx.Err()
			}
			runErr := firstErr
			if useFirstErr {
				useFirstErr = false
			} else {
				runErr = fn(ctx)
			}
			if runErr == nil {
				return struct{}{}, nil
			}
			if cfg.Retryable != nil && !cfg.Retryable(runErr) {
				slog.Warn("Operation failed with non-retryable error", "attempt", attempt, "error", runErr)
				return struct{}{}, backoff.Permanent(runErr)
			}
			return struct{}{}, runErr
		},
		backoff.WithBackOff(retryBackoff),
		// #nosec G115 -- applyDefaults clamps MaxAttempts to [1, maxRetryAttempts].
		backoff.WithMaxTries(uint(cfg.MaxAttempts)),
		backoff.WithMaxElapsedTime(0),
		backoff.WithNotify(func(err error, delay time.Duration) {
			slog.Warn(
				"Operation failed, retrying",
				"attempt",
				attempt,
				"maxAttempts",
				cfg.MaxAttempts,
				"error",
				err,
				"nextDelay",
				delay,
			)
			attempt++
		}),
	)
	if err == nil {
		return nil
	}
	var permanent *backoff.PermanentError
	if errors.As(err, &permanent) {
		return permanent.Unwrap()
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	slog.Error("Retry attempts exhausted, giving up", "attempt", attempt, "maxAttempts", cfg.MaxAttempts, "error", err)
	return err
}

func applyDefaults(cfg Config) Config {
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 3
	}
	if cfg.MaxAttempts > maxRetryAttempts {
		cfg.MaxAttempts = maxRetryAttempts
	}
	if cfg.InitialInterval <= 0 {
		cfg.InitialInterval = 1 * time.Second
	}
	if cfg.MaxInterval <= 0 {
		cfg.MaxInterval = 30 * time.Second
	}
	if cfg.Multiplier <= 1.0 {
		cfg.Multiplier = 2.0
	}
	if cfg.MaxJitter == 0 {
		cfg.MaxJitter = 100 * time.Millisecond
	}
	if cfg.MaxJitter < 0 {
		cfg.MaxJitter = 0
	}
	return cfg
}

type jitterBackOff struct {
	base      backoff.BackOff
	maxJitter time.Duration
}

func (j *jitterBackOff) Reset() {
	j.base.Reset()
}

func (j *jitterBackOff) NextBackOff() time.Duration {
	delay := j.base.NextBackOff()
	if delay == backoff.Stop || j.maxJitter <= 0 {
		return delay
	}
	// #nosec G404 -- Math/rand is sufficient for jitter, crypto/rand not needed
	return delay + time.Duration(rand.Int63n(int64(j.maxJitter)))
}
