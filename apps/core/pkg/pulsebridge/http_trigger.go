package pulsebridge

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/pulse"
)

var secureJitterInt = cryptorand.Int

// NewHTTPTrigger creates a trigger that calls a remote HTTP endpoint to wake an agent.
// This is useful for calling the taskforceai engine API.
// The parent context is used for request cancellation; if nil, a background context is used.
func NewHTTPTrigger(parentCtx context.Context, url, token string) pulse.InteractionTrigger {
	if parentCtx == nil {
		parentCtx = context.Background() //nolint:contextcheck // Nil is a documented compatibility fallback.
	}
	client := &http.Client{Timeout: 30 * time.Second}
	const (
		maxAttempts        = 3
		baseBackoff        = 250 * time.Millisecond
		maxBackoff         = 3 * time.Second
		failureThreshold   = 3
		circuitOpenWindow  = 30 * time.Second
		defaultRequestTime = 30 * time.Second
	)

	// Capture the parent context for cancellation (e.g., from the bridge).
	var breakerMu sync.Mutex
	consecutiveFailures := 0
	circuitOpenUntil := time.Time{}

	return func(agentID, reason string) error {
		breakerMu.Lock()
		if !circuitOpenUntil.IsZero() && time.Now().Before(circuitOpenUntil) {
			remaining := time.Until(circuitOpenUntil).Round(time.Millisecond)
			breakerMu.Unlock()
			return fmt.Errorf("pulse trigger circuit open, retry after %s", remaining)
		}
		breakerMu.Unlock()

		payload := map[string]any{
			"agentId": agentID,
			"reason":  reason,
			"ts":      time.Now().UnixMilli(),
		}
		data, _ := json.Marshal(payload)

		var finalErr error
		retryableErr := false
		for attempt := 1; attempt <= maxAttempts; attempt++ {
			retryableErr = false
			func() {
				reqCtx, cancel := context.WithTimeout(parentCtx, defaultRequestTime)
				defer cancel()

				req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(data))
				if err != nil {
					finalErr = err
					return
				}

				req.Header.Set("Content-Type", "application/json")
				if token != "" {
					req.Header.Set("Authorization", "Bearer "+token)
				}

				resp, err := client.Do(req)
				if err != nil {
					finalErr = err
					// Parent cancellation/deadlines should fail fast and avoid retries.
					if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
						retryableErr = true
					}
					return
				}

				defer func() {
					_, _ = io.Copy(io.Discard, resp.Body)
					_ = resp.Body.Close()
				}()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					finalErr = nil
					return
				}
				if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
					// 4xx (except 429) are considered caller/data errors and are not retried.
					finalErr = fmt.Errorf("unexpected status code: %d", resp.StatusCode)
					return
				}
				retryableErr = true
				finalErr = fmt.Errorf("retryable status code: %d", resp.StatusCode)
			}()

			if finalErr == nil {
				break
			}
			if !retryableErr || attempt == maxAttempts {
				break
			}

			backoff := min(baseBackoff*time.Duration(1<<(attempt-1)), maxBackoff)
			jitter := secureJitter(100 * time.Millisecond)
			time.Sleep(backoff + jitter)
		}

		breakerMu.Lock()
		defer breakerMu.Unlock()
		if finalErr == nil {
			consecutiveFailures = 0
			circuitOpenUntil = time.Time{}
			return nil
		}
		if !retryableErr {
			return finalErr
		}
		consecutiveFailures++
		if consecutiveFailures >= failureThreshold {
			circuitOpenUntil = time.Now().Add(circuitOpenWindow)
			consecutiveFailures = 0
		}
		return finalErr
	}
}

func secureJitter(max time.Duration) time.Duration {
	if max <= 0 {
		return 0
	}
	n, err := secureJitterInt(cryptorand.Reader, big.NewInt(int64(max)))
	if err != nil {
		return 0
	}
	return time.Duration(n.Int64())
}
