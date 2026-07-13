package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandler_VersionAsString(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	tokenString := createValidToken("user-123")
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user-123", 123, false)
	})

	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	mock.xReadFunc = func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
		return []goredis.XMessage{
			{
				ID: "3-0",
				Values: map[string]any{
					"type":    "sync_required",
					"version": "42", // Redis stream values may arrive as strings
				},
			},
		}, nil
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var resp PollResponse
	_ = json.NewDecoder(w.Result().Body).Decode(&resp)
	assert.Len(t, resp.Messages, 1)
	assert.Equal(t, 42, resp.Messages[0].Version)
}

func TestValidateSyncToken_WrongAudience(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	// Token with a different audience should be rejected
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "user",
		"aud": "some-other-service",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(secret))
	_, err := validateSyncToken(tokenString)
	assert.Error(t, err)
}

func TestValidateSyncToken_WrongIssuer(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "user",
		"aud": "sync-realtime",
		"iss": "some-other-service",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(secret))
	_, err := validateSyncToken(tokenString)
	assert.Error(t, err)
}

func TestValidateSyncToken_UnexpectedSigningMethod(t *testing.T) {
	t.Setenv("AUTH_SECRET", testAuthSecret())
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"sub": "user",
		"aud": "sync-realtime",
		"iss": "taskforceai-sync",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	_, err := validateSyncToken(tokenString)
	assert.Error(t, err)
}

func TestSyncMessage_JSON(t *testing.T) {
	msg := SyncMessage{
		Type:    "test",
		Version: 1,
		ID:      "msg-123",
	}
	assert.Equal(t, "test", msg.Type)
	assert.Equal(t, 1, msg.Version)
	assert.Equal(t, "msg-123", msg.ID)
}

func TestPollResponse_JSON(t *testing.T) {
	resp := PollResponse{
		Messages: []SyncMessage{
			{Type: "test", Version: 1, ID: "1"},
		},
		LastID: "$",
	}
	assert.Len(t, resp.Messages, 1)
	assert.Equal(t, "$", resp.LastID)
}

func TestHandler_IPv6RemoteAddr(t *testing.T) {
	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	// Issue 5 failed auth requests from an IPv6 address.
	for range 5 {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = "[::1]:8080"
		Handler(w, r)
		assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
	}

	// The 6th request should be rate-limited.
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "[::1]:8080"
	Handler(w, r)
	assert.Equal(t, http.StatusTooManyRequests, w.Result().StatusCode,
		"IPv6 clients should be rate-limited after 5 failures")
}

func TestHandler_ValidAuthNotBlockedAfterFailedAuthBurst(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	token := createValidAccessToken(0)
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user@example.com", 87, false)
	})

	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	mock.xReadFunc = func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
		return []goredis.XMessage{}, nil
	}

	for range 5 {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = "203.0.113.9:8080"
		Handler(w, r)
		assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "203.0.113.9:8080"
	r.Header.Set("Authorization", "Bearer "+token)
	Handler(w, r)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestHandler_AuthHeaderUsesOrgScopedStreamKey(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	token := createValidAccessToken(42)
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user@example.com", 42, false)
		expectRealtimeMembershipLookup(mock, 42, 42)
	})

	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	var capturedStream string
	mock.xReadFunc = func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
		capturedStream = stream
		return []goredis.XMessage{}, nil
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "198.51.100.3:4444"
	r.Header.Set("Authorization", "Bearer "+token)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	assert.Equal(t, "sync:stream:org:42", capturedStream)
}

// TestHandler_FailCounter_ConcurrentAccess verifies there is no data race when
// multiple goroutines concurrently hit the fail counter on the same IP.
// Run with: go test -race ./...
func TestHandler_FailCounter_ConcurrentAccess(t *testing.T) {
	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	const goroutines = 20
	statusCodes := make(chan int, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for range goroutines {
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = "10.0.0.1:1234"
			Handler(w, r)
			statusCodes <- w.Result().StatusCode
		}()
	}
	wg.Wait()
	close(statusCodes)

	unauthorizedCount := 0
	tooManyCount := 0
	for code := range statusCodes {
		switch code {
		case http.StatusUnauthorized:
			unauthorizedCount++
		case http.StatusTooManyRequests:
			tooManyCount++
		}
	}

	assert.Equal(t, 5, unauthorizedCount, "first 5 failed auth attempts should be unauthorized")
	assert.Equal(t, goroutines-5, tooManyCount, "remaining attempts should be rate-limited")
}

func TestNormalizeNumericClaim_AllSupportedTypes(t *testing.T) {
	cases := []struct {
		name string
		raw  any
		want string
	}{
		{name: "float64", raw: float64(42), want: "42"},
		{name: "float32", raw: float32(42), want: "42"},
		{name: "int", raw: int(42), want: "42"},
		{name: "int8", raw: int8(42), want: "42"},
		{name: "int16", raw: int16(42), want: "42"},
		{name: "int32", raw: int32(42), want: "42"},
		{name: "int64", raw: int64(42), want: "42"},
		{name: "uint", raw: uint(42), want: "42"},
		{name: "uint8", raw: uint8(42), want: "42"},
		{name: "uint16", raw: uint16(42), want: "42"},
		{name: "uint32", raw: uint32(42), want: "42"},
		{name: "uint64", raw: uint64(42), want: "42"},
		{name: "string", raw: " 42 ", want: "42"},
		{name: "unsupported", raw: struct{}{}, want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, normalizeNumericClaim(tc.raw))
		})
	}
}

func TestOrganizationIDFromClaims_Fallbacks(t *testing.T) {
	assert.Equal(t, "7", organizationIDFromClaims(map[string]any{"org": int32(7)}))
	assert.Equal(t, "8", organizationIDFromClaims(map[string]any{"org": struct{}{}, "org_id": uint64(8)}))
	assert.Empty(t, organizationIDFromClaims(map[string]any{"org": struct{}{}}))
}

func TestRecordAuthFailureAndCheckLimit_RedisErrors(t *testing.T) {
	assert.False(t, recordAuthFailureAndCheckLimit(context.Background(), &mockCmdable{incrErr: errors.New("redis down")}, "key"))
	assert.False(t, recordAuthFailureAndCheckLimit(context.Background(), &mockCmdable{expireErr: errors.New("ttl failed")}, "key"))
}

func TestRecordAuthFailureAndCheckLimit_RepairsMissingTTL(t *testing.T) {
	client := &mockCmdable{kv: map[string]int{"key": 1}, ttl: -1 * time.Second}

	assert.False(t, recordAuthFailureAndCheckLimit(context.Background(), client, "key"))
	assert.Equal(t, 1, client.expires)
}

func TestObserveEmptyPollResponse_EncodeFailure(t *testing.T) {
	originalEncode := encodePollResponse
	encodePollResponse = func(http.ResponseWriter, PollResponse) error {
		return errors.New("encode failed")
	}
	defer func() { encodePollResponse = originalEncode }()

	outcome, err := observeEmptyPollResponse(httptest.NewRecorder(), "9-0", "success", nil)

	require.Error(t, err)
	assert.Equal(t, "encode_failed", outcome)
}

func TestSameRealtimeAuthContext_FallsBackToAccessSubject(t *testing.T) {
	assert.True(t, sameRealtimeAuthContext(
		jwt.MapClaims{"sub": "User@Example.com", "org": int32(7)},
		jwt.MapClaims{"sub": "user@example.com", "org_id": float64(7)},
	))
}

func TestRepairMissingAuthFailureTTL_ErrorBranches(t *testing.T) {
	repairMissingAuthFailureTTL(context.Background(), &mockCmdable{ttlErr: errors.New("ttl failed")}, "key")

	client := &mockCmdable{ttl: -1 * time.Second, expireErr: errors.New("expire failed")}
	repairMissingAuthFailureTTL(context.Background(), client, "key")
	assert.Zero(t, client.expires)
}
