package billing

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	"github.com/claywarren/revenuecat"
)

// RevenueCatError represents an error from the RevenueCat API
type RevenueCatError string

const (
	ErrRevenueCatNotFound RevenueCatError = "NOT_FOUND"
	ErrRevenueCatAPI      RevenueCatError = "API_ERROR"
)

var (
	revenueCatCB *circuitbreaker.CircuitBreaker
	revenueCatMu sync.Mutex
)

// isRevenueCatTransientError returns true if the error is transient.
func isRevenueCatTransientError(err error) bool {
	return upstream.ErrorContainsAny(err, "timeout", "connection", "rate", "500", "503")
}

func getRevenueCatCircuitBreaker() *circuitbreaker.CircuitBreaker {
	revenueCatMu.Lock()
	defer revenueCatMu.Unlock()
	if revenueCatCB == nil {
		revenueCatCB = upstream.NewCircuitBreaker("billing_revenuecat", 60*time.Second, isRevenueCatTransientError)
	}
	return revenueCatCB
}

// RevenueCatSDK defines the interface for the RevenueCat SDK
type RevenueCatSDK interface {
	GetSubscriber(appUserID string) (revenuecat.Subscriber, error)
}

// RevenueCatClient wraps the RevenueCat SDK client
type RevenueCatClient struct {
	client RevenueCatSDK
	cb     *circuitbreaker.CircuitBreaker
}

// NewRevenueCatClient creates a new RevenueCat client
func NewRevenueCatClient(secretKey string) *RevenueCatClient {
	return &RevenueCatClient{
		client: revenuecat.New(secretKey),
		cb:     getRevenueCatCircuitBreaker(),
	}
}

// DefaultRevenueCatClient returns a client using the environment secret key
var DefaultRevenueCatClient = func() (*RevenueCatClient, error) {
	secretKey := strings.TrimSpace(os.Getenv("REVENUECAT_SECRET_KEY"))
	if secretKey == "" {
		return nil, &revenuecat.Error{Message: "REVENUECAT_SECRET_KEY not configured"}
	}
	return NewRevenueCatClient(secretKey), nil
}

// FetchSubscriber retrieves subscriber data from RevenueCat
func (c *RevenueCatClient) FetchSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError) {
	var result *revenuecat.Subscriber
	var resultErr RevenueCatError

	err := c.cb.Execute(ctx, func() error {
		subscriber, err := c.client.GetSubscriber(appUserID)
		if err != nil {
			// Check if it's a not found error
			var rcErr *revenuecat.Error
			if errors.As(err, &rcErr) && rcErr.Code == 7225 {
				resultErr = ErrRevenueCatNotFound
				return nil // Not found is not a failure for circuit breaker
			}
			resultErr = ErrRevenueCatAPI
			return err
		}
		result = &subscriber
		return nil
	})

	if errors.Is(err, circuitbreaker.ErrCircuitOpen) {
		slog.Warn("RevenueCat circuit breaker is open, rejecting request", "appUserId", appUserID)
		return nil, ErrRevenueCatAPI
	}

	if resultErr != "" && resultErr != ErrRevenueCatNotFound {
		slog.Error("RevenueCat FetchSubscriber failed", "error", resultErr, "appUserId", appUserID)
	}

	return result, resultErr
}

// FetchRevenueCatSubscriber is a convenience function using default client
func FetchRevenueCatSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError) {
	client, err := DefaultRevenueCatClient()
	if err != nil {
		return nil, ErrRevenueCatAPI
	}
	return client.FetchSubscriber(ctx, appUserID)
}
