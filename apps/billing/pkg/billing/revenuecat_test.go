package billing

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	"github.com/claywarren/revenuecat"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// newTestRevenueCatBreaker returns a fresh circuit breaker so error-path
// tests can't trip the shared singleton open for later tests
// (order-dependent failures under go test -shuffle).
func newTestRevenueCatBreaker() *circuitbreaker.CircuitBreaker {
	return upstream.NewCircuitBreaker("billing_revenuecat_test", 60*time.Second, isRevenueCatTransientError)
}

func TestNewRevenueCatClient(t *testing.T) {
	client := NewRevenueCatClient("test_secret_key")

	assert.NotNil(t, client)
	assert.NotNil(t, client.client)
}

func TestDefaultRevenueCatClient_NoEnvVar(t *testing.T) {
	t.Setenv("REVENUECAT_SECRET_KEY", "")

	client, err := DefaultRevenueCatClient()

	assert.Nil(t, client)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "RevenueCat v2 API key not configured")
}

func TestDefaultRevenueCatClient_WithEnvVar(t *testing.T) {
	t.Setenv("REVENUECAT_SECRET_KEY", "rc_test_secret")

	client, err := DefaultRevenueCatClient()

	require.NoError(t, err)
	assert.NotNil(t, client)
	assert.NotNil(t, client.client)
}

func TestDefaultRevenueCatClient_IgnoresLegacyV1APIKey(t *testing.T) {
	t.Setenv("REVENUECAT_V1_API_KEY", "appl_public_v1")
	t.Setenv("REVENUECAT_SECRET_KEY", "")

	client, err := DefaultRevenueCatClient()

	require.Error(t, err)
	assert.Nil(t, client)
}

func TestFetchRevenueCatSubscriber_NoEnvVar(t *testing.T) {
	t.Setenv("REVENUECAT_SECRET_KEY", "")

	subscriber, err := FetchRevenueCatSubscriber(context.Background(), "app_user_123")

	assert.Nil(t, subscriber)
	assert.Equal(t, ErrRevenueCatAPI, err)
}

func TestIsRevenueCatTransientError(t *testing.T) {
	assert.True(t, isRevenueCatTransientError(errors.New("timeout")))
	assert.True(t, isRevenueCatTransientError(errors.New("connection refused")))
	assert.True(t, isRevenueCatTransientError(errors.New("rate limited")))
	assert.True(t, isRevenueCatTransientError(errors.New("500 internal server error")))
	assert.True(t, isRevenueCatTransientError(errors.New("503 service unavailable")))
	assert.False(t, isRevenueCatTransientError(nil))
	assert.False(t, isRevenueCatTransientError(errors.New("invalid request")))
}

type mockRevenueCatSDK struct {
	mock.Mock
	subscriber      revenuecat.Subscriber
	entitlementsErr error
}

func (m *mockRevenueCatSDK) GetCustomer(_ context.Context, appUserID string) (revenuecat.V2Customer, error) {
	args := m.MethodCalled("GetSubscriber", appUserID)
	val, _ := args.Get(0).(revenuecat.Subscriber)
	m.subscriber = val
	return revenuecat.V2Customer{ID: appUserID, ProjectID: revenueCatProjectID}, args.Error(1)
}

func (m *mockRevenueCatSDK) ListAllActiveEntitlements(_ context.Context, _ string) ([]revenuecat.V2ActiveEntitlement, error) {
	if m.entitlementsErr != nil {
		return nil, m.entitlementsErr
	}
	entitlements := make([]revenuecat.V2ActiveEntitlement, 0, len(m.subscriber.Entitlements))
	for id, entitlement := range m.subscriber.Entitlements {
		entitlements = append(entitlements, revenuecat.V2ActiveEntitlement{
			EntitlementID: id,
			ExpiresAt:     entitlement.ExpiresDate,
		})
	}
	return entitlements, nil
}

func TestRevenueCatClient_FetchSubscriber_EntitlementsErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want RevenueCatError
	}{
		{
			name: "not found",
			err:  &revenuecat.V2Error{StatusCode: 404, Type: "resource_missing", Message: "missing"},
			want: ErrRevenueCatNotFound,
		},
		{name: "api failure", err: errors.New("entitlements unavailable"), want: ErrRevenueCatAPI},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSDK := &mockRevenueCatSDK{entitlementsErr: tt.err}
			mockSDK.On("GetSubscriber", "user-entitlements").Return(revenuecat.Subscriber{}, nil)
			client := &RevenueCatClient{client: mockSDK, cb: newTestRevenueCatBreaker()}

			sub, got := client.FetchSubscriber(context.Background(), "user-entitlements")

			assert.Nil(t, sub)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsRevenueCatNotFound_TypedNil(t *testing.T) {
	var revenueCatError *revenuecat.V2Error
	var err error = revenueCatError

	assert.False(t, isRevenueCatNotFound(err))
}

func TestFetchRevenueCatSubscriber_Success(t *testing.T) {
	mockSDK := new(mockRevenueCatSDK)
	cb := newTestRevenueCatBreaker()
	mockClient := &RevenueCatClient{
		client: mockSDK,
		cb:     cb,
	}

	origDefault := DefaultRevenueCatClient
	defer func() { DefaultRevenueCatClient = origDefault }()
	DefaultRevenueCatClient = func() (*RevenueCatClient, error) {
		return mockClient, nil
	}

	expiresAt := time.Now().Add(24 * time.Hour)
	expectedSub := revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			revenueCatEntitlementProID: {ExpiresDate: &expiresAt},
		},
	}
	mockSDK.On("GetSubscriber", "user123").Return(expectedSub, nil)

	sub, err := FetchRevenueCatSubscriber(context.Background(), "user123")
	assert.Empty(t, err)
	assert.NotNil(t, sub)
	assert.Equal(t, expiresAt, *sub.Entitlements[revenueCatEntitlementProID].ExpiresDate)
}

func TestFetchRevenueCatSubscriber_InitError(t *testing.T) {
	origDefault := DefaultRevenueCatClient
	defer func() { DefaultRevenueCatClient = origDefault }()
	DefaultRevenueCatClient = func() (*RevenueCatClient, error) {
		return nil, errors.New("mock initialization error")
	}

	sub, err := FetchRevenueCatSubscriber(context.Background(), "user123")
	assert.Nil(t, sub)
	assert.Equal(t, ErrRevenueCatAPI, err)
}

func TestRevenueCatClient_FetchSubscriber_Success(t *testing.T) {
	mockSDK := new(mockRevenueCatSDK)
	client := &RevenueCatClient{
		client: mockSDK,
		cb:     newTestRevenueCatBreaker(),
	}

	expiresAt := time.Now().Add(24 * time.Hour)
	expectedSub := revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			revenueCatEntitlementProID: {ExpiresDate: &expiresAt},
		},
	}
	mockSDK.On("GetSubscriber", "user123").Return(expectedSub, nil)

	sub, err := client.FetchSubscriber(context.Background(), "user123")
	assert.Empty(t, err)
	assert.NotNil(t, sub)
	assert.Equal(t, expiresAt, *sub.Entitlements[revenueCatEntitlementProID].ExpiresDate)
}

func TestRevenueCatClient_FetchSubscriber_NotFound(t *testing.T) {
	mockSDK := new(mockRevenueCatSDK)
	client := &RevenueCatClient{
		client: mockSDK,
		cb:     newTestRevenueCatBreaker(),
	}

	rcErr := &revenuecat.V2Error{StatusCode: 404, Type: "resource_missing", Message: "Customer not found"}
	mockSDK.On("GetSubscriber", "user404").Return(revenuecat.Subscriber{}, rcErr)

	sub, err := client.FetchSubscriber(context.Background(), "user404")
	assert.Nil(t, sub)
	assert.Equal(t, ErrRevenueCatNotFound, err)
}

func TestRevenueCatClient_FetchSubscriber_CircuitOpen(t *testing.T) {
	mockSDK := new(mockRevenueCatSDK)
	client := &RevenueCatClient{
		client: mockSDK,
		cb:     nil,
	}

	sub, err := client.FetchSubscriber(context.Background(), "user123")

	assert.Nil(t, sub)
	assert.Equal(t, ErrRevenueCatAPI, err)
	mockSDK.AssertNotCalled(t, "GetSubscriber")
}

func TestRevenueCatClient_FetchSubscriber_APIError(t *testing.T) {
	mockSDK := new(mockRevenueCatSDK)
	client := &RevenueCatClient{
		client: mockSDK,
		cb:     newTestRevenueCatBreaker(),
	}

	mockSDK.On("GetSubscriber", "user_error").Return(revenuecat.Subscriber{}, errors.New("api error"))

	sub, err := client.FetchSubscriber(context.Background(), "user_error")
	assert.Nil(t, sub)
	assert.Equal(t, ErrRevenueCatAPI, err)
}

func TestRevenueCatClient_FetchSubscriber_OpenCircuit(t *testing.T) {
	mockSDK := new(mockRevenueCatSDK)
	mockSDK.On("GetSubscriber", "user_error").Return(revenuecat.Subscriber{}, errors.New("timeout")).Once()
	client := &RevenueCatClient{
		client: mockSDK,
		cb: circuitbreaker.New(circuitbreaker.Config{
			Name:             "billing_revenuecat_open_test",
			FailureThreshold: 1,
			ResetTimeout:     time.Minute,
			IsTransient:      func(error) bool { return true },
		}),
	}

	_, firstErr := client.FetchSubscriber(context.Background(), "user_error")
	_, secondErr := client.FetchSubscriber(context.Background(), "user_error")

	assert.Equal(t, ErrRevenueCatAPI, firstErr)
	assert.Equal(t, ErrRevenueCatAPI, secondErr)
	mockSDK.AssertNumberOfCalls(t, "GetSubscriber", 1)
}

// TestGetRevenueCatCircuitBreaker_ConcurrentAccess is a regression test for TF-0544.
// Before the fix, getRevenueCatCircuitBreaker had no mutex, causing a data race
// when multiple goroutines raced to initialise the circuit-breaker singleton.
// Run with: go test -race ./...
func TestGetRevenueCatCircuitBreaker_ConcurrentAccess(t *testing.T) {
	// Reset the singleton so every goroutine observes nil and races to init.
	revenueCatCB = nil

	const goroutines = 20
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for range goroutines {
		go func() {
			defer wg.Done()
			cb := getRevenueCatCircuitBreaker()
			assert.NotNil(t, cb)
		}()
	}
	wg.Wait()

	// All goroutines must have obtained the same singleton.
	assert.NotNil(t, revenueCatCB)
}
