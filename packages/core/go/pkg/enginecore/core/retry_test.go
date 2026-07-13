package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestRetryDelay(t *testing.T) {
	t.Run("backoff without headers", func(t *testing.T) {
		assert.Equal(t, 2000, RetryDelay(0, nil))
		assert.Equal(t, 2000, RetryDelay(1, nil))
		assert.Equal(t, 4000, RetryDelay(2, nil))
		assert.Equal(t, 8000, RetryDelay(3, nil))
		assert.Equal(t, 30000, RetryDelay(10, nil)) // Cap at MaxDelayNoHeaders
	})

	t.Run("with retry-after-ms header", func(t *testing.T) {
		err := &APIError{
			ResponseHeaders: map[string]string{"retry-after-ms": "500"},
		}
		assert.Equal(t, 500, RetryDelay(1, err))
	})

	t.Run("with retry-after header (seconds)", func(t *testing.T) {
		err := &APIError{
			ResponseHeaders: map[string]string{"retry-after": "1.5"},
		}
		assert.Equal(t, 1500, RetryDelay(1, err))
	})

	t.Run("invalid retry headers use capped backoff", func(t *testing.T) {
		err := &APIError{
			ResponseHeaders: map[string]string{"retry-after-ms": "later"},
		}
		assert.Equal(t, 2000, RetryDelay(1, err))
	})

	t.Run("retry-after date header", func(t *testing.T) {
		err := &APIError{
			ResponseHeaders: map[string]string{
				"retry-after": time.Now().Add(2 * time.Second).UTC().Format(time.RFC1123),
			},
		}
		delay := RetryDelay(1, err)
		assert.Positive(t, delay)
		assert.LessOrEqual(t, delay, 2000)
	})
}

func TestRetryable(t *testing.T) {
	assert.Empty(t, (*APIError)(nil).Error())
	assert.Equal(t, "plain", (&APIError{Message: "plain"}).Error())
	assert.Empty(t, Retryable(nil))
	assert.Empty(t, Retryable(&APIError{IsRetryable: false}))
	assert.Equal(t, "boom", Retryable(&APIError{IsRetryable: true, Message: "boom"}))
	assert.Equal(t, "Provider is overloaded", Retryable(&APIError{IsRetryable: true, Message: "Overloaded!"}))
}
