package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

type mockCmdable struct {
	redispkg.Cmdable
	xReadFunc func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error)
	kv        map[string]int
	mu        sync.Mutex
	incrErr   error
	expireErr error
	delErr    error
	ttl       time.Duration
	ttlErr    error
	expires   int
}

func (m *mockCmdable) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	if m.xReadFunc != nil {
		return m.xReadFunc(ctx, stream, lastID, count)
	}
	return nil, nil
}

func (m *mockCmdable) Get(ctx context.Context, key string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v, ok := m.kv[key]; ok {
		return fmt.Sprintf("%d", v), nil
	}
	return "", goredis.Nil
}

func (m *mockCmdable) Incr(ctx context.Context, key string) (int, error) {
	if m.incrErr != nil {
		return 0, m.incrErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.kv == nil {
		m.kv = make(map[string]int)
	}
	m.kv[key]++
	return m.kv[key], nil
}

func (m *mockCmdable) Expire(ctx context.Context, key string, expiration time.Duration) (bool, error) {
	if m.expireErr != nil {
		return false, m.expireErr
	}
	m.expires++
	return true, nil
}

func (m *mockCmdable) TTL(ctx context.Context, key string) (time.Duration, error) {
	if m.ttlErr != nil {
		return 0, m.ttlErr
	}
	if m.ttl != 0 {
		return m.ttl, nil
	}
	return time.Minute, nil
}

func (m *mockCmdable) Del(ctx context.Context, key string) (bool, error) {
	if m.delErr != nil {
		return false, m.delErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.kv != nil {
		delete(m.kv, key)
	}
	return true, nil
}

func createValidToken(sub string) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub,
		"aud": "sync-realtime",
		"iss": "taskforceai-sync",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(testAuthSecret()))
	return tokenString
}

func resetPollTelemetryForTest() {
	pollTelemetryOnce = sync.Once{}
	pollTelemetryInst = pollTelemetry{}
}

func setupPollTracerRecorder(t *testing.T, options ...sdktrace.TracerProviderOption) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	providerOptions := append([]sdktrace.TracerProviderOption{sdktrace.WithSpanProcessor(recorder)}, options...)
	tp := sdktrace.NewTracerProvider(providerOptions...)
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prev)
		resetPollTelemetryForTest()
	})
	resetPollTelemetryForTest()
	return recorder
}

func pollAttrMap(attrs []attribute.KeyValue) map[attribute.Key]attribute.Value {
	out := make(map[attribute.Key]attribute.Value, len(attrs))
	for _, kv := range attrs {
		out[kv.Key] = kv.Value
	}
	return out
}

func realtimeMessagesWithTraceContext(count int) []goredis.XMessage {
	messages := make([]goredis.XMessage, 0, count)
	for i := 1; i <= count; i++ {
		messages = append(messages, goredis.XMessage{
			ID: fmt.Sprintf("%d-0", i),
			Values: map[string]any{
				"type":        "sync_required",
				"version":     "7",
				"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				"tracestate":  "vendor=value",
			},
		})
	}
	return messages
}

func testAuthSecret() string {
	return strings.Join([]string{"test", "secret", "32", "characters", "long!!"}, "-")
}

func TestPollMessageType_MissingType(t *testing.T) {
	assert.Empty(t, pollMessageType(map[string]any{}))
}

func createValidAccessToken(orgID float64) string {
	return createAccessToken("user@example.com", orgID)
}

func createAccessToken(email string, orgID float64) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email":  email,
		"sub":    email,
		"org_id": orgID,
		"exp":    time.Now().Add(time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(testAuthSecret()))
	return tokenString
}

func withRealtimeQueries(t *testing.T, configure func(mock pgxmock.PgxPoolIface)) {
	t.Helper()

	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)

	if configure != nil {
		configure(mock)
	}

	originalGetQueries := getQueries
	getQueries = func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}

	t.Cleanup(func() {
		getQueries = originalGetQueries
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})
}

func expectRealtimeUserLookup(mock pgxmock.PgxPoolIface, email string, userID int32, disabled bool) {
	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(email).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: userID, Email: email, Disabled: disabled, APITier: "STARTER", APIRequestsLimit: 100,
		}))
}

func expectRealtimeMembershipLookup(mock pgxmock.PgxPoolIface, orgID int32, userID int32) {
	now := time.Now()
	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(orgID, userID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), orgID, userID, "owner", now, now))
}

func TestHandler_SuccessPath(t *testing.T) {
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

	var capturedStream string
	var capturedLastID string
	mock.xReadFunc = func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
		capturedStream = stream
		capturedLastID = lastID
		return []goredis.XMessage{
			{
				ID: "1-0",
				Values: map[string]any{
					"type":    "conversation_updated",
					"version": 5,
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
	assert.Equal(t, "conversation_updated", resp.Messages[0].Type)
	assert.Equal(t, 5, resp.Messages[0].Version)
	assert.Equal(t, "1-0", resp.LastID)
	assert.Equal(t, "sync:stream:123", capturedStream)
	assert.Equal(t, "0", capturedLastID)
}

func TestHandler_EmitsDurableFallbackWhenDatabaseVersionAdvances(t *testing.T) {
	t.Setenv("AUTH_SECRET", testAuthSecret())
	tokenString := createValidToken("user-123")
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user-123", 123, false)
		mock.ExpectQuery("SELECT GREATEST").WithArgs(pgxmock.AnyArg()).WillReturnRows(
			pgxmock.NewRows([]string{"latest_version"}).AddRow(int32(8)),
		)
	})

	originalGetRedisClient := getRedisClient
	getRedisClient = func() (redispkg.Cmdable, error) { return &mockCmdable{}, nil }
	t.Cleanup(func() { getRedisClient = originalGetRedisClient })

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString+"&last_version=7", nil)
	Handler(w, r)

	require.Equal(t, http.StatusOK, w.Code)
	var response PollResponse
	require.NoError(t, json.NewDecoder(w.Body).Decode(&response))
	require.Equal(t, 8, response.LatestVersion)
	require.Len(t, response.Messages, 1)
	require.Equal(t, SyncMessage{Type: "sync_required", Version: 8, ID: "db:8"}, response.Messages[0])
}

func TestRealtimeVersionRemainingBranches(t *testing.T) {
	assert.Zero(t, parseNonNegativeVersion(nil))
	assert.Zero(t, parseNonNegativeVersion([]string{"-1"}))
	assert.Zero(t, parseNonNegativeVersion([]string{"not-a-number"}))
	assert.Equal(t, 7, parseNonNegativeVersion([]string{" 7 "}))
	assert.True(t, containsSyncVersion([]SyncMessage{{Type: "sync_required", Version: 8}}, 7))
	assert.False(t, containsSyncVersion([]SyncMessage{{Type: "other", Version: 8}}, 7))

	originalGetQueries := getQueries
	getQueries = func(context.Context) (*db.Queries, error) { return nil, errors.New("db unavailable") }
	_, err := getLatestSyncVersion(context.Background(), "user", "")
	require.ErrorContains(t, err, "db unavailable")
	getQueries = originalGetQueries

	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		userID := "user"
		mock.ExpectQuery("SELECT GREATEST").WithArgs(&userID).WillReturnRows(pgxmock.NewRows([]string{"latest_version"}).AddRow(int32(4)))
		orgID := int32(9)
		mock.ExpectQuery("SELECT GREATEST").WithArgs(&orgID).WillReturnRows(pgxmock.NewRows([]string{"latest_version"}).AddRow(int32(6)))
	})
	version, err := getLatestSyncVersion(context.Background(), "user", "")
	require.NoError(t, err)
	assert.Equal(t, 4, version)
	_, err = getLatestSyncVersion(context.Background(), "user", "bad-org")
	require.ErrorContains(t, err, "parse organization id")
	version, err = getLatestSyncVersion(context.Background(), "user", "9")
	require.NoError(t, err)
	assert.Equal(t, 6, version)
}

func TestHandler_DurableVersionLookupFailureStillResponds(t *testing.T) {
	t.Setenv("AUTH_SECRET", testAuthSecret())
	tokenString := createValidToken("version-error@example.com")
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "version-error@example.com", 123, false)
		mock.ExpectQuery("SELECT GREATEST").WithArgs(pgxmock.AnyArg()).WillReturnError(errors.New("version failed"))
	})
	originalGetRedisClient := getRedisClient
	getRedisClient = func() (redispkg.Cmdable, error) { return &mockCmdable{}, nil }
	t.Cleanup(func() { getRedisClient = originalGetRedisClient })

	w := httptest.NewRecorder()
	Handler(w, httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString+"&last_version=1", nil))
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestHandler_SuppressesPerMessageSpansFromRedisTraceContext(t *testing.T) {
	previousPropagator := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTextMapPropagator(previousPropagator)
	})

	recorder := setupPollTracerRecorder(t)

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
		return realtimeMessagesWithTraceContext(100), nil
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var resp PollResponse
	require.NoError(t, json.NewDecoder(w.Result().Body).Decode(&resp))
	require.Len(t, resp.Messages, 100)
	assert.Equal(t, "100-0", resp.LastID)

	pollSpanCount := 0
	messageSpanCount := 0
	for _, span := range recorder.Ended() {
		switch span.Name() {
		case "sync.realtime.poll":
			pollSpanCount++
			attrs := pollAttrMap(span.Attributes())
			assert.Equal(t, int64(100), attrs["sync.realtime.message_count"].AsInt64())
		case "sync.realtime.message":
			messageSpanCount++
		}
	}
	assert.Equal(t, 1, pollSpanCount)
	assert.Zero(t, messageSpanCount)
}

func TestHandler_RedisTraceContextCannotForceSampling(t *testing.T) {
	previousPropagator := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTextMapPropagator(previousPropagator)
	})

	recorder := setupPollTracerRecorder(t, sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.NeverSample())))

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
		return realtimeMessagesWithTraceContext(2), nil
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var resp PollResponse
	require.NoError(t, json.NewDecoder(w.Result().Body).Decode(&resp))
	require.Len(t, resp.Messages, 2)
	assert.Empty(t, recorder.Ended())
}

func TestHandler_CORSPreflight(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/", nil)

	Handler(w, r)

	assert.Equal(t, http.StatusNoContent, w.Result().StatusCode)
}

func TestHandler_LogsDeleteRateLimitError(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	tokenString := createValidToken("user-123")
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user-123", 123, false)
	})

	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{delErr: errors.New("delete failed")}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	mock.xReadFunc = func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
		return []goredis.XMessage{}, nil
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestHandler_EncodeFailure(t *testing.T) {
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
		return []goredis.XMessage{{ID: "1-0", Values: map[string]any{"type": "sync_required"}}}, nil
	}

	originalEncode := encodePollResponse
	encodePollResponse = func(http.ResponseWriter, PollResponse) error {
		return errors.New("encode failed")
	}
	defer func() { encodePollResponse = originalEncode }()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestPollTelemetryRecordsOutcomeAttributes(t *testing.T) {
	recorder := setupPollTracerRecorder(t)
	req := httptest.NewRequest(http.MethodGet, "/?last_id=1-0", nil)

	ctx, span := startPollSpan(context.Background(), req)
	finishPollObservation(ctx, span, time.Now().Add(-5*time.Millisecond), "success", "organization", 3, nil)

	_, failedSpan := startPollSpan(context.Background(), req)
	finishPollObservation(context.Background(), failedSpan, time.Now().Add(-5*time.Millisecond), "empty_read_error", "user", 0, errors.New("redis read failed"))

	ended := recorder.Ended()
	require.Len(t, ended, 2)
	assert.Equal(t, codes.Ok, ended[0].Status().Code)
	assert.Equal(t, codes.Error, ended[1].Status().Code)

	attrs := pollAttrMap(ended[0].Attributes())
	assert.Equal(t, "success", attrs["sync.realtime.outcome"].AsString())
	assert.Equal(t, "organization", attrs["sync.realtime.scope"].AsString())
	assert.Equal(t, int64(3), attrs["sync.realtime.message_count"].AsInt64())
}

func TestHandler_DifferentVersionTypes(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	tokenString := createValidToken("user-123")
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		for range 3 {
			expectRealtimeUserLookup(mock, "user-123", 123, false)
		}
	})

	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	// Test int, int64 and float64 as well
	versions := []any{10, int64(11), float64(15)}
	for _, v := range versions {
		mock.xReadFunc = func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
			return []goredis.XMessage{
				{
					ID: "2-0",
					Values: map[string]any{
						"type":    "msg",
						"version": v,
					},
				},
			}, nil
		}

		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
		Handler(w, r)

		var resp PollResponse
		_ = json.NewDecoder(w.Result().Body).Decode(&resp)
		var expected int
		switch n := v.(type) {
		case int:
			expected = n
		case int64:
			expected = int(n)
		case float64:
			expected = int(n)
		}
		assert.Equal(t, expected, resp.Messages[0].Version)
	}
}

func TestHandler_RedisError(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	tokenString := createValidToken("user-123")

	originalGetRedisClient := getRedisClient
	getRedisClient = func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis down")
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestHandler_RedisStreamUnavailable(t *testing.T) {
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
		return nil, errors.New("stream operations require REDIS_URL")
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var resp PollResponse
	_ = json.NewDecoder(w.Result().Body).Decode(&resp)
	assert.Empty(t, resp.Messages)
}

func TestHandler_RedisNilReturnsEmptyPoll(t *testing.T) {
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
		return nil, goredis.Nil
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString+"&last_id=7-0", nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var resp PollResponse
	_ = json.NewDecoder(w.Result().Body).Decode(&resp)
	assert.Empty(t, resp.Messages)
	assert.Equal(t, "7-0", resp.LastID)
}

func TestHandler_RedisGenericReadError(t *testing.T) {
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
		return nil, errors.New("generic error")
	}

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var resp PollResponse
	_ = json.NewDecoder(w.Result().Body).Decode(&resp)
	assert.Empty(t, resp.Messages)
}

func TestHandler_PanicRecovery(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	tokenString := createValidToken("user-123")

	originalGetRedisClient := getRedisClient
	getRedisClient = func() (redispkg.Cmdable, error) {
		panic("something went wrong")
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	// Handler should recover
	assert.NotPanics(t, func() {
		Handler(w, r)
	})
	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestHandler_MethodNotAllowed(t *testing.T) {
	originalGetRedisClient := getRedisClient
	getRedisClient = func() (redispkg.Cmdable, error) {
		return nil, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/?sync_token=invalid", nil)
	Handler(w, r)

	assert.Equal(t, http.StatusMethodNotAllowed, w.Result().StatusCode)
}

func TestHandler_Unauthorized(t *testing.T) {
	originalGetRedisClient := getRedisClient
	mock := &mockCmdable{}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mock, nil
	}
	defer func() { getRedisClient = originalGetRedisClient }()

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestResolveUserID_Empty(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	userID, orgID := resolveUserID(r)
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_QueryToken(t *testing.T) {
	t.Setenv("AUTH_SECRET", testAuthSecret())

	//#nosec G101 - This is a test token, not a real credential
	tokenString := "invalid.jwt.token"

	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	userID, orgID := resolveUserID(r)
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_QueryToken_DisabledUserRejected(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	tokenString := createValidToken("disabled@example.com")
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "disabled@example.com", 77, true)
	})

	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
	userID, orgID := resolveUserID(r)
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_AuthorizationHeader(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer invalid-token")
	userID, orgID := resolveUserID(r)
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_AuthorizationHeader_CaseInsensitiveAndOrg(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	token := createValidAccessToken(42)
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user@example.com", 42, false)
		expectRealtimeMembershipLookup(mock, 42, 42)
	})

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "bearer "+token)
	userID, orgID := resolveUserID(r)
	assert.Equal(t, "42", userID)
	assert.Equal(t, "42", orgID)
}

func TestResolveUserID_AuthorizationHeader_MissingMembershipRejected(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	token := createValidAccessToken(42)
	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user@example.com", 42, false)
		mock.ExpectQuery("SELECT (.+) FROM memberships").
			WithArgs(int32(42), int32(42)).
			WillReturnError(errors.New("not a member"))
	})

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	userID, orgID := resolveUserID(r)
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveRealtimeUser_LookupBranches(t *testing.T) {
	userID, orgID := resolveRealtimeUser(context.Background(), " ", "")
	assert.Empty(t, userID)
	assert.Empty(t, orgID)

	originalGetQueries := getQueries
	getQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}
	userID, orgID = resolveRealtimeUser(context.Background(), "user@example.com", "")
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
	getQueries = originalGetQueries

	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		mock.ExpectQuery("SELECT (.+) FROM users").
			WithArgs("missing@example.com").
			WillReturnError(errors.New("not found"))
	})
	userID, orgID = resolveRealtimeUser(context.Background(), "missing@example.com", "")
	assert.Empty(t, userID)
	assert.Empty(t, orgID)

	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "zero@example.com", 0, false)
	})
	userID, orgID = resolveRealtimeUser(context.Background(), "zero@example.com", "")
	assert.Empty(t, userID)
	assert.Empty(t, orgID)

	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user@example.com", 42, false)
	})
	userID, orgID = resolveRealtimeUser(context.Background(), "user@example.com", "not-int")
	assert.Empty(t, userID)
	assert.Empty(t, orgID)

	withRealtimeQueries(t, func(mock pgxmock.PgxPoolIface) {
		expectRealtimeUserLookup(mock, "user@example.com", 42, false)
	})
	userID, orgID = resolveRealtimeUser(context.Background(), "user@example.com", "0")
	assert.Equal(t, "42", userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_AuthorizationHeader_RevokedTokenRejected(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	token := createValidAccessToken(42)

	originalIsTokenRevoked := adapterhandler.IsTokenRevoked
	adapterhandler.IsTokenRevoked = func(_ context.Context, rawToken string) bool {
		return rawToken == token
	}
	defer func() {
		adapterhandler.IsTokenRevoked = originalIsTokenRevoked
	}()

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	userID, orgID := resolveUserID(r)
	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_QueryTokenRequiresMatchingAuthorizationContext(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	syncToken := createValidToken("user@example.com")
	otherAccessToken := createAccessToken("other@example.com", 42)

	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+syncToken, nil)
	r.Header.Set("Authorization", "Bearer "+otherAccessToken)
	userID, orgID := resolveUserID(r)

	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestResolveUserID_QueryTokenRejectsRevokedAuthorizationHeader(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)
	syncToken := createValidToken("user@example.com")
	accessToken := createValidAccessToken(42)

	originalIsTokenRevoked := adapterhandler.IsTokenRevoked
	adapterhandler.IsTokenRevoked = func(_ context.Context, rawToken string) bool {
		return rawToken == accessToken
	}
	defer func() {
		adapterhandler.IsTokenRevoked = originalIsTokenRevoked
	}()

	r := httptest.NewRequest(http.MethodGet, "/?sync_token="+syncToken, nil)
	r.Header.Set("Authorization", "Bearer "+accessToken)
	userID, orgID := resolveUserID(r)

	assert.Empty(t, userID)
	assert.Empty(t, orgID)
}

func TestValidateSyncToken_MissingSecret(t *testing.T) {
	_ = os.Unsetenv("AUTH_SECRET")
	_, err := validateSyncToken("some-token")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTH_SECRET not set")
}

func TestValidateSyncToken_InvalidToken(t *testing.T) {
	t.Setenv("AUTH_SECRET", testAuthSecret())
	_, err := validateSyncToken("invalid-token-format")
	assert.Error(t, err)
}
