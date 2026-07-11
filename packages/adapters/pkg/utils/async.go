package utils

import (
	"context"
	"time"

	backoff "github.com/cenkalti/backoff/v5"
)

func Sleep(ms int) {
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

func Retry[T any](fn func() (T, error), retries int, delay time.Duration, backoffFactor float64) (T, error) {
	if retries < 0 {
		retries = 0
	}
	maxInt := int(^uint(0) >> 1)
	if retries == maxInt {
		retries--
	}

	exponential := backoff.NewExponentialBackOff()
	exponential.InitialInterval = delay
	exponential.RandomizationFactor = 0
	if backoffFactor > 1 {
		exponential.Multiplier = backoffFactor
		maxInterval := delay
		for i := 0; i < retries; i++ {
			nextInterval := time.Duration(float64(maxInterval) * backoffFactor)
			if nextInterval <= 0 {
				break
			}
			maxInterval = nextInterval
		}
		exponential.MaxInterval = maxInterval
	} else {
		exponential.Multiplier = 1
		exponential.MaxInterval = delay
	}

	return backoff.Retry(
		context.Background(),
		fn,
		backoff.WithBackOff(exponential),
		backoff.WithMaxTries(uint(retries+1)), // #nosec G115 -- retries is non-negative and capped below max int above.
		backoff.WithMaxElapsedTime(0),
	)
}
