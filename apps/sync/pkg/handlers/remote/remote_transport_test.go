package remote

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRemoteCommandPollRejectsConcurrentLongPollForSameDevice(t *testing.T) {
	user := &adapterauth.AuthenticatedUser{ID: 42}
	now := time.Now().UTC()
	pool := newRemotePool(t)
	for range 2 {
		pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
	}
	client := &blockingRemoteRedisStub{
		remoteRedisStub: newRemoteRedisStub(),
		started:         make(chan struct{}),
		release:         make(chan struct{}),
	}
	router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, func() (redis.Cmdable, error) {
		return client, nil
	})
	path := "/api/v1/remote/devices/mac-1/commands?waitMs=10000"

	firstResponse := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		firstResponse <- remoteRequest(t, router, http.MethodGet, path, "mac-1", "")
	}()
	select {
	case <-client.started:
	case <-time.After(time.Second):
		t.Fatal("first long poll did not reach Redis")
	}

	secondResponse := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		secondResponse <- remoteRequest(t, router, http.MethodGet, path, "mac-1", "")
	}()
	select {
	case response := <-secondResponse:
		assert.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
	case <-time.After(250 * time.Millisecond):
		close(client.release)
		<-firstResponse
		<-secondResponse
		t.Fatal("concurrent long poll reached the blocking Redis read")
	}

	close(client.release)
	response := <-firstResponse
	assert.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NoError(t, pool.ExpectationsWereMet())
}

func TestReadRemoteCommandsReleasesLongPollLease(t *testing.T) {
	client := newRemoteRedisStub()
	for range 2 {
		messages, err := readRemoteCommands(t.Context(), client, "42", "mac-1", "0", time.Second)
		require.NoError(t, err)
		assert.Empty(t, messages)
	}
	assert.Equal(t, time.Second, client.blockWait)
}

func TestRemoteWebSocketRelaysCommandsAndStoresResults(t *testing.T) {
	user := &adapterauth.AuthenticatedUser{ID: 42}
	pool := newRemotePool(t)
	now := time.Now().UTC()
	pool.ExpectQuery("SELECT (.+) FROM remote_targets").
		WithArgs("42", "mac-1").
		WillReturnRows(remoteTargetRows("Mac", true, false, now))
	pool.ExpectExec("UPDATE remote_targets").
		WithArgs("42", "mac-1").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	pool.ExpectQuery("SELECT EXISTS").
		WithArgs("42", "mac-1", "phone-1").
		WillReturnRows(pgxmock.NewRows([]string{"active"}).AddRow(true))

	redisServer := miniredis.RunT(t)
	rawRedis := goredis.NewClient(&goredis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { require.NoError(t, rawRedis.Close()) })
	client := redis.NewClient(rawRedis)
	_, err := client.XAdd(t.Context(), commandStream("42", "mac-1"), map[string]any{
		"command": fmt.Sprintf(`{"id":"command-1","controllerDeviceId":"phone-1","request":{"jsonrpc":"2.0","id":8,"method":"server.ping"},"createdAt":%q}`, now.Format(time.RFC3339Nano)),
	})
	require.NoError(t, err)

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(context.WithValue(r.Context(), adapterhandler.UserContextKey, user))
			next.ServeHTTP(w, r)
		})
	})
	done := make(chan struct{})
	handler := WebSocketHandler(
		func(context.Context) (*db.Queries, error) { return db.New(pool), nil },
		func() (redis.Cmdable, error) { return client, nil },
	)
	router.Get("/api/v1/remote/devices/{targetDeviceId}/ws", func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		handler.ServeHTTP(w, r)
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	headers := http.Header{}
	headers.Set("X-Device-Id", "mac-1")
	headers.Set("X-Device-Credential", remoteTestCredential)
	conn, response, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/remote/devices/mac-1/ws?lastId=0",
		headers,
	)
	require.NoError(t, err)
	require.Equal(t, http.StatusSwitchingProtocols, response.StatusCode)
	require.NoError(t, response.Body.Close())

	var batch remoteWebSocketEnvelope
	require.NoError(t, conn.ReadJSON(&batch))
	require.Equal(t, "commands", batch.Type)
	require.Len(t, batch.Commands, 1)
	require.Equal(t, "command-1", batch.Commands[0].ID)
	require.NotEqual(t, "0", batch.LastID)
	require.NoError(t, conn.WriteJSON(remoteWebSocketEnvelope{Type: "heartbeat"}))
	require.NoError(t, conn.WriteJSON(remoteWebSocketEnvelope{
		Type:               "result",
		CommandID:          "command-1",
		ControllerDeviceID: "phone-1",
		Response:           json.RawMessage(`{"jsonrpc":"2.0","id":8,"result":{"ok":true}}`),
		LastID:             batch.LastID,
	}))
	var acknowledgement remoteWebSocketEnvelope
	require.NoError(t, conn.ReadJSON(&acknowledgement))
	require.Equal(t, "resultAck", acknowledgement.Type)
	require.Equal(t, "command-1", acknowledgement.CommandID)
	require.Equal(t, batch.LastID, acknowledgement.LastID)

	require.Eventually(t, func() bool {
		value, getErr := rawRedis.Get(t.Context(), resultKey("42", "mac-1", "command-1")).Result()
		return getErr == nil && strings.Contains(value, `"ok":true`)
	}, time.Second, 10*time.Millisecond)
	require.NoError(t, conn.Close())
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Remote WebSocket handler did not stop after the client closed")
	}
	require.NoError(t, pool.ExpectationsWereMet())
}

func TestRemoteWebSocketRejectsBrowserOrigins(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/remote", nil)
	request.Header.Set("Origin", "https://attacker.example")
	assert.False(t, remoteWebSocketUpgrader.CheckOrigin(request))
	request.Header.Del("Origin")
	assert.True(t, remoteWebSocketUpgrader.CheckOrigin(request))
}

func TestAcquireRemotePollLeaseFailurePaths(t *testing.T) {
	t.Run("token generation", func(t *testing.T) {
		originalRead := readRandom
		readRandom = func([]byte) (int, error) { return 0, assert.AnError }
		t.Cleanup(func() { readRandom = originalRead })

		lease, err := acquireRemotePollLease(t.Context(), newRemoteRedisStub(), "42", "mac-1")
		assert.Nil(t, lease)
		assert.ErrorContains(t, err, "create remote poll lease token")
	})

	t.Run("device lease Redis failure", func(t *testing.T) {
		client := newRemoteRedisStub()
		client.operation = "setnx"
		client.err = assert.AnError
		lease, err := acquireRemotePollLease(t.Context(), client, "42", "mac-1")
		assert.Nil(t, lease)
		assert.ErrorContains(t, err, "acquire remote device poll lease")
	})

	t.Run("user slot Redis failure", func(t *testing.T) {
		client := newRemoteRedisStub()
		client.operation = "setnx"
		client.err = assert.AnError
		client.setNXErrAt = 2
		lease, err := acquireRemotePollLease(t.Context(), client, "42", "mac-1")
		assert.Nil(t, lease)
		assert.ErrorContains(t, err, "acquire remote user poll slot")
	})

	t.Run("user capacity", func(t *testing.T) {
		client := newRemoteRedisStub()
		for slot := range remotePollSlots {
			lease, err := acquireRemotePollLease(t.Context(), client, "42", fmt.Sprintf("mac-%d", slot))
			require.NoError(t, err)
			require.NotNil(t, lease)
		}
		lease, err := acquireRemotePollLease(t.Context(), client, "42", "mac-5")
		assert.Nil(t, lease)
		assert.ErrorIs(t, err, errRemotePollCapacity)
	})
}

func TestRemoteCommandResultFailurePaths(t *testing.T) {
	user := &adapterauth.AuthenticatedUser{ID: 42}
	validBody := `{"response":{"controllerDeviceId":"phone-1","response":{"jsonrpc":"2.0","id":1,"result":{}}}}`

	for _, test := range []struct {
		name     string
		deviceID string
		body     string
		client   *remoteRedisStub
		redisErr bool
		expected int
	}{
		{"target mismatch", "other", validBody, newRemoteRedisStub(), false, http.StatusForbidden},
		{"missing response", "mac-1", `{}`, newRemoteRedisStub(), false, http.StatusUnprocessableEntity},
		{"relay unavailable", "mac-1", validBody, newRemoteRedisStub(), true, http.StatusServiceUnavailable},
		{"invalid envelope", "mac-1", `{"response":{"jsonrpc":"2.0"}}`, newRemoteRedisStub(), false, http.StatusBadRequest},
		{"result storage failure", "mac-1", validBody, &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "set", err: assert.AnError}, false, http.StatusServiceUnavailable},
	} {
		t.Run("put "+test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			resolveRedis := func() (redis.Cmdable, error) {
				if test.redisErr {
					return nil, assert.AnError
				}
				return test.client, nil
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, resolveRedis)
			response := remoteRequest(t, router, http.MethodPut, "/api/v1/remote/devices/mac-1/commands/cmd-1/result", test.deviceID, test.body)
			assert.Equal(t, test.expected, response.Code, response.Body.String())
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}

	for _, test := range []struct {
		name       string
		deviceID   string
		authorized any
		client     *remoteRedisStub
		redisError bool
		expected   int
	}{
		{"invalid controller", "", nil, newRemoteRedisStub(), false, http.StatusBadRequest},
		{"inactive connection", "phone-1", false, newRemoteRedisStub(), false, http.StatusForbidden},
		{"connection lookup failure", "phone-1", assert.AnError, newRemoteRedisStub(), false, http.StatusForbidden},
		{"relay unavailable", "phone-1", true, newRemoteRedisStub(), true, http.StatusServiceUnavailable},
		{"pending", "phone-1", true, newRemoteRedisStub(), false, http.StatusOK},
		{"relay read failure", "phone-1", true, &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "get", err: assert.AnError}, false, http.StatusServiceUnavailable},
		{"wrong controller", "phone-1", true, &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{"remote:result:42:mac-1:cmd-1": `{"controllerDeviceId":"other","response":{}}`}}, false, http.StatusForbidden},
	} {
		t.Run("get "+test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			if test.authorized != nil {
				expectation := pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1")
				if lookupErr, ok := test.authorized.(error); ok {
					expectation.WillReturnError(lookupErr)
				} else {
					expectation.WillReturnRows(pgxmock.NewRows([]string{"authorized"}).AddRow(test.authorized))
				}
			}
			resolveRedis := func() (redis.Cmdable, error) {
				if test.redisError {
					return nil, assert.AnError
				}
				return test.client, nil
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, resolveRedis)
			response := remoteRequest(t, router, http.MethodGet, "/api/v1/remote/devices/mac-1/commands/cmd-1/result", test.deviceID, "")
			assert.Equal(t, test.expected, response.Code, response.Body.String())
			if test.name == "pending" {
				assert.Contains(t, response.Body.String(), `"status":"pending"`)
			}
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}
