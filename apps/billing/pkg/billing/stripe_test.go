package billing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTimestampToDate_Zero(t *testing.T) {
	result := TimestampToDate(0)
	assert.Nil(t, result)
}

func TestTimestampToDate_ValidTimestamp(t *testing.T) {
	timestamp := int64(1700000000) // Nov 14, 2023
	result := TimestampToDate(timestamp)

	assert.NotNil(t, result)
	assert.Equal(t, timestamp, result.Unix())
}

func TestTimestampToDate_NegativeTimestamp(t *testing.T) {
	// Should handle negative (pre-epoch) timestamps
	timestamp := int64(-86400) // One day before epoch
	result := TimestampToDate(timestamp)

	assert.NotNil(t, result)
	assert.Equal(t, timestamp, result.Unix())
}

type fakeNetErr struct{}

func (fakeNetErr) Error() string   { return "net error" }
func (fakeNetErr) Timeout() bool   { return false }
func (fakeNetErr) Temporary() bool { return true }

func TestIsStripeTransientError(t *testing.T) {
	assert.True(t, isStripeTransientError(errors.New("timeout while connecting")))
	assert.True(t, isStripeTransientError(errors.New("rate_limit exceeded")))
	assert.True(t, isStripeTransientError(errors.New("500 server error")))
	assert.True(t, isStripeTransientError(net.Error(fakeNetErr{})))
	assert.False(t, isStripeTransientError(errors.New("bad request")))
	assert.False(t, isStripeTransientError(nil))
}

func TestStripeClient_Struct(t *testing.T) {
	// Basic struct test - can't test actual Stripe calls without API key
	client := &StripeClient{secretKey: "sk_test_123"}
	assert.Equal(t, "sk_test_123", client.secretKey)
}

func TestTimestampToDate_ReturnsCorrectTime(t *testing.T) {
	// Test a known timestamp
	timestamp := int64(1609459200) // 2021-01-01 00:00:00 UTC
	result := TimestampToDate(timestamp)

	assert.NotNil(t, result)

	expectedTime := time.Unix(timestamp, 0).UTC()
	assert.Equal(t, expectedTime, *result)
	assert.Equal(t, time.UTC, result.Location())
}

func TestNewStripeClient_NoEnvVar(t *testing.T) {
	// Clear any existing env
	t.Setenv("STRIPE_SECRET_KEY", "")

	// Reset singleton
	stripeInstance = nil
	stripeSecret = ""

	client, err := NewStripeClient()

	assert.Nil(t, client)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "STRIPE_SECRET_KEY is not set")
}

func TestNewStripeClient_WithEnvVar(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_12345")

	// Reset singleton
	stripeInstance = nil
	stripeSecret = ""

	client, err := NewStripeClient()

	require.NoError(t, err)
	assert.NotNil(t, client)
	assert.Equal(t, "sk_test_12345", client.secretKey)
}

func TestNewStripeClient_Singleton(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_singleton")

	// Reset singleton
	stripeInstance = nil
	stripeSecret = ""

	client1, err1 := NewStripeClient()
	client2, err2 := NewStripeClient()

	assert.NoError(t, err1)
	assert.NoError(t, err2)
	assert.Same(t, client1, client2) // Should be same instance
}

func TestNewStripeClient_SecretChanged(t *testing.T) {
	// Set initial secret
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_original")
	stripeInstance = nil
	stripeSecret = ""

	client1, _ := NewStripeClient()

	// Change secret
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_changed")

	client2, _ := NewStripeClient()

	// Should be different instances since secret changed
	assert.NotSame(t, client1, client2)
	assert.Equal(t, "sk_test_changed", client2.secretKey)
}

func TestVerifyWebhookSignature_NoEnvVar(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")

	event, err := VerifyWebhookSignature([]byte("payload"), "sig")

	assert.Nil(t, event)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "STRIPE_WEBHOOK_SECRET is not set")
}

func TestVerifyWebhookSignature_InvalidSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	event, err := VerifyWebhookSignature([]byte("invalid payload"), "invalid_signature")

	assert.Nil(t, event)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid webhook signature")
}

func resetStripeClientForTest() {
	stripeMu.Lock()
	defer stripeMu.Unlock()
	stripeInstance = nil
	stripeSecret = ""
}

func TestResetStripeClientForTest(t *testing.T) {
	t.Setenv("NODE_ENV", "test")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_reset")

	// Initialize client
	stripeInstance = nil
	stripeSecret = ""
	_, err := NewStripeClient()
	require.NoError(t, err)

	assert.NotNil(t, stripeInstance)

	// Reset
	resetStripeClientForTest()

	assert.Nil(t, stripeInstance)
	assert.Empty(t, stripeSecret)
}

// TestNewStripeClient_ConcurrentInit is a regression test for TF-0544.
// Before the fix, NewStripeClient had no mutex protecting the singleton
// variables, causing a data race when multiple goroutines called it
// concurrently during startup. Run with: go test -race ./...
func TestNewStripeClient_ConcurrentInit(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_concurrent")
	t.Setenv("NODE_ENV", "test")

	const goroutines = 20
	// Reset once before the goroutines start.
	resetStripeClientForTest()

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for range goroutines {
		go func() {
			defer wg.Done()
			client, err := NewStripeClient()
			assert.NoError(t, err)
			assert.NotNil(t, client)
		}()
	}
	wg.Wait()
}

func TestVerifyWebhookSignature_Success(t *testing.T) {
	secret := "whsec_test_secret"
	t.Setenv("STRIPE_WEBHOOK_SECRET", secret)

	payload := []byte(`{"id": "evt_123", "object": "event", "api_version": "2025-08-27.basil"}`)
	timestamp := time.Now().Unix()

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%d.", timestamp)
	mac.Write(payload)
	signature := hex.EncodeToString(mac.Sum(nil))

	header := fmt.Sprintf("t=%d,v1=%s", timestamp, signature)

	event, err := VerifyWebhookSignature(payload, header)

	require.NoError(t, err)
	assert.NotNil(t, event)
	assert.Equal(t, "evt_123", event.ID)
}
