package lazy

import (
	"context"
	"sync"
)

type Resolver[T any] func(context.Context) (T, error)

func Cached[T any](build Resolver[T]) Resolver[T] {
	var (
		mu    sync.Mutex
		value T
		ready bool
	)

	return func(ctx context.Context) (T, error) {
		mu.Lock()
		defer mu.Unlock()

		if ready {
			return value, nil
		}

		next, err := build(ctx)
		if err != nil {
			var zero T
			return zero, err
		}
		value = next
		ready = true
		return value, nil
	}
}
