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
	revenueCatProjectID                   = "projbe92b832"
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

// RevenueCatSDK defines the RevenueCat v2 operations used by billing.
type RevenueCatSDK interface {
	GetCustomer(ctx context.Context, customerID string) (revenuecat.V2Customer, error)
	ListAllActiveEntitlements(ctx context.Context, customerID string) ([]revenuecat.V2ActiveEntitlement, error)
}

// RevenueCatClient wraps the RevenueCat v2 SDK client.
type RevenueCatClient struct {
	client RevenueCatSDK
	cb     *circuitbreaker.CircuitBreaker
}

// NewRevenueCatClient creates a RevenueCat v2 client for the TaskForceAI project.
func NewRevenueCatClient(secretKey string) *RevenueCatClient {
	return &RevenueCatClient{
		client: revenuecat.NewV2(secretKey, revenueCatProjectID),
		cb:     getRevenueCatCircuitBreaker(),
	}
}

func revenueCatAPIKey() string {
	return strings.TrimSpace(os.Getenv("REVENUECAT_SECRET_KEY"))
}

// DefaultRevenueCatClient returns a client using the environment secret key
var DefaultRevenueCatClient = func() (*RevenueCatClient, error) {
	apiKey := revenueCatAPIKey()
	if apiKey == "" {
		return nil, errors.New("RevenueCat v2 API key not configured")
	}
	return NewRevenueCatClient(apiKey), nil
}

// FetchSubscriber retrieves v2 customer data and normalizes it into the
// billing service's established subscriber snapshot.
func (c *RevenueCatClient) FetchSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError) {
	if c == nil || c.client == nil || c.cb == nil {
		return nil, ErrRevenueCatAPI
	}
	var result *revenuecat.Subscriber
	var resultErr RevenueCatError

	err := c.cb.Execute(ctx, func() error {
		_, err := c.client.GetCustomer(ctx, appUserID)
		if err != nil {
			if isRevenueCatNotFound(err) {
				resultErr = ErrRevenueCatNotFound
				return nil
			}
			resultErr = ErrRevenueCatAPI
			return err
		}

		entitlements, err := c.client.ListAllActiveEntitlements(ctx, appUserID)
		if err != nil {
			if isRevenueCatNotFound(err) {
				resultErr = ErrRevenueCatNotFound
				return nil
			}
			resultErr = ErrRevenueCatAPI
			return err
		}

		result = &revenuecat.Subscriber{
			Entitlements: make(map[string]revenuecat.Entitlement, len(entitlements)),
		}
		for _, entitlement := range entitlements {
			result.Entitlements[entitlement.EntitlementID] = revenuecat.Entitlement{
				ExpiresDate: entitlement.ExpiresAt,
			}
		}
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

func isRevenueCatNotFound(err error) bool {
	var rcErr *revenuecat.V2Error
	return errors.As(err, &rcErr) && rcErr.StatusCode == 404
}

// FetchRevenueCatSubscriber is a convenience function using the default client.
func FetchRevenueCatSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError) {
	client, err := DefaultRevenueCatClient()
	if err != nil {
		return nil, ErrRevenueCatAPI
	}
	return client.FetchSubscriber(ctx, appUserID)
}
