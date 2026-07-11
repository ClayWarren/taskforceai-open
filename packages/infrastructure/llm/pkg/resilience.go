package pkg

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/retry"
	"go.opentelemetry.io/otel/trace"
)

func runCompletionWithResilience(
	ctx context.Context,
	span trace.Span,
	breaker *circuitbreaker.CircuitBreaker,
	retryable func(error) bool,
	model string,
	failureMessage string,
	nilMessage string,
	call func(context.Context) (*agent.ChatCompletion, error),
) (*agent.ChatCompletion, error) {
	var completion *agent.ChatCompletion
	err := breaker.Execute(ctx, func() error {
		return retry.Do(ctx, retry.Config{
			MaxAttempts:     3,
			InitialInterval: 500 * time.Millisecond,
			MaxInterval:     5 * time.Second,
			Multiplier:      2.0,
			Retryable:       retryable,
		}, func(retryCtx context.Context) error {
			var err error
			completion, err = call(retryCtx)
			return err
		})
	})
	if err != nil {
		recordSpanError(span, err)
		slog.Error(failureMessage, "model", model, "error", err)
		return nil, err
	}
	if completion == nil {
		err := errors.New(nilMessage)
		recordSpanError(span, err)
		return nil, err
	}
	setCompletionUsageAttributes(span, completion.Usage)
	return completion, nil
}

type llmEventStream[T any] interface {
	Next() bool
	Current() T
	Err() error
	Close() error
}

func consumeLLMEventStream[T any](
	ctx context.Context,
	span trace.Span,
	stream llmEventStream[T],
	cancelStream context.CancelFunc,
	timeout time.Duration,
	model string,
	timeoutMessage string,
	failureMessage string,
	handleEvent func(T),
) error {
	if cancelStream == nil {
		cancelStream = func() {}
	}

	results := make(chan llmStreamResult[T])

	go func() {
		defer close(results)
		defer func() { _ = stream.Close() }()
		for {
			if !stream.Next() {
				if err := stream.Err(); err != nil {
					sendLLMStreamResult(ctx, results, llmStreamResult[T]{err: err})
					return
				}
				sendLLMStreamResult(ctx, results, llmStreamResult[T]{done: true})
				return
			}
			event := stream.Current()
			if !sendLLMStreamResult(ctx, results, llmStreamResult[T]{event: event}) {
				return
			}
		}
	}()

	for {
		chunkTimer := time.NewTimer(timeout)
		select {
		case res, ok := <-results:
			chunkTimer.Stop()
			if !ok || res.done {
				return nil
			}
			if res.err != nil {
				recordSpanError(span, res.err)
				slog.Error(failureMessage, "model", model, "error", res.err)
				return res.err
			}
			if handleEvent != nil {
				handleEvent(res.event)
			}
		case <-chunkTimer.C:
			cancelStream()
			err := context.DeadlineExceeded
			recordSpanError(span, err)
			setSpanError(span, "stream chunk timeout")
			slog.Error(timeoutMessage, "model", model)
			return err
		case <-ctx.Done():
			chunkTimer.Stop()
			cancelStream()
			return ctx.Err()
		}
	}
}

// llmStreamResult carries a single event, a terminal error, or a done marker
// from the reader goroutine to the consumer loop.
type llmStreamResult[T any] struct {
	event T
	err   error
	done  bool
}

// sendLLMStreamResult delivers res to results, abandoning the send if ctx is
// cancelled first (the consumer has stopped reading). It reports whether the
// send succeeded.
func sendLLMStreamResult[T any](ctx context.Context, results chan<- llmStreamResult[T], res llmStreamResult[T]) bool {
	select {
	case results <- res:
		return true
	case <-ctx.Done():
		return false
	}
}
