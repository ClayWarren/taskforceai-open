package submission

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/retry"
	"github.com/inngest/inngestgo"
)

func getSubmissionCircuitBreaker() *circuitbreaker.CircuitBreaker {
	// Already initialized in init()
	return submissionCircuitBreaker
}

func sendTaskEventWithResilience(
	ctx context.Context,
	sender InngestSender,
	event inngestgo.GenericEvent[map[string]any],
) error {
	breaker := getSubmissionCircuitBreaker()
	return breaker.Execute(ctx, func() error {
		return retry.Do(ctx, retry.Config{
			MaxAttempts:     3,
			InitialInterval: 250 * time.Millisecond,
			MaxInterval:     3 * time.Second,
			Multiplier:      2,
			MaxJitter:       200 * time.Millisecond,
			Retryable:       isRetryableInngestError,
		}, func(callCtx context.Context) error {
			_, err := sender.Send(callCtx, event)
			return err
		})
	})
}

func isRetryableInngestError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	message := strings.ToLower(err.Error())
	retryableTokens := []string{
		"timeout",
		"temporarily unavailable",
		"service unavailable",
		"connection reset",
		"connection refused",
		"broken pipe",
		"rate limit",
		"too many requests",
		"429",
		"500",
		"502",
		"503",
		"504",
	}
	for _, token := range retryableTokens {
		if strings.Contains(message, token) {
			return true
		}
	}
	return false
}
