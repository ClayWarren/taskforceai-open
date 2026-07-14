package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/go-chi/chi/v5"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type remoteWebSocketRead struct {
	envelope remoteWebSocketEnvelope
	err      error
}

type remoteWebSocketConnectionStub struct {
	reads           chan remoteWebSocketRead
	writeJSONErr    error
	writeControlErr error
	pongHandler     func(string) error
	deadlineCalls   int
}

func newRemoteWebSocketConnectionStub(reads ...remoteWebSocketRead) *remoteWebSocketConnectionStub {
	readChannel := make(chan remoteWebSocketRead, len(reads))
	for _, read := range reads {
		readChannel <- read
	}
	return &remoteWebSocketConnectionStub{reads: readChannel}
}

func (*remoteWebSocketConnectionStub) SetReadLimit(int64) {}

func (conn *remoteWebSocketConnectionStub) SetReadDeadline(time.Time) error {
	conn.deadlineCalls++
	return nil
}

func (conn *remoteWebSocketConnectionStub) SetPongHandler(handler func(string) error) {
	conn.pongHandler = handler
}

func (conn *remoteWebSocketConnectionStub) ReadJSON(value any) error {
	read, ok := <-conn.reads
	if !ok {
		return io.EOF
	}
	if read.err != nil {
		return read.err
	}
	*(value.(*remoteWebSocketEnvelope)) = read.envelope
	return nil
}

func (conn *remoteWebSocketConnectionStub) WriteJSON(any) error {
	return conn.writeJSONErr
}

func (conn *remoteWebSocketConnectionStub) WriteControl(int, []byte, time.Time) error {
	return conn.writeControlErr
}

type remoteWebSocketRedisStub struct {
	*remoteRedisStub
	read func(context.Context, string, string, int64, time.Duration) ([]goredis.XMessage, error)
}

func (client *remoteWebSocketRedisStub) XReadBlock(
	ctx context.Context,
	stream string,
	lastID string,
	count int64,
	wait time.Duration,
) ([]goredis.XMessage, error) {
	return client.read(ctx, stream, lastID, count, wait)
}

func blockingRemoteWebSocketRedisStub() *remoteWebSocketRedisStub {
	return &remoteWebSocketRedisStub{
		remoteRedisStub: newRemoteRedisStub(),
		read: func(ctx context.Context, _ string, _ string, _ int64, _ time.Duration) ([]goredis.XMessage, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}
}

func remoteWebSocketRequest(
	t *testing.T,
	user *adapterauth.AuthenticatedUser,
	resolveQueries QueriesResolver,
	resolveRedis RedisResolver,
	deviceID string,
	credential string,
) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if user != nil {
				request = request.WithContext(context.WithValue(request.Context(), adapterhandler.UserContextKey, user))
			}
			next.ServeHTTP(writer, request)
		})
	})
	router.Get("/api/v1/remote/devices/{targetDeviceId}/ws", WebSocketHandler(resolveQueries, resolveRedis))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/remote/devices/mac-1/ws", nil)
	request.Header.Set("X-Device-Id", deviceID)
	request.Header.Set("X-Device-Credential", credential)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestRemoteWebSocketHandlerFailurePaths(t *testing.T) {
	user := &adapterauth.AuthenticatedUser{ID: 42}
	unusedQueries := func(context.Context) (*db.Queries, error) { return nil, assert.AnError }
	unusedRedis := func() (redis.Cmdable, error) { return nil, assert.AnError }

	t.Run("unauthorized", func(t *testing.T) {
		response := remoteWebSocketRequest(t, nil, unusedQueries, unusedRedis, "mac-1", remoteTestCredential)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
	})

	t.Run("queries unavailable", func(t *testing.T) {
		response := remoteWebSocketRequest(t, user, unusedQueries, unusedRedis, "mac-1", remoteTestCredential)
		assert.Equal(t, http.StatusServiceUnavailable, response.Code)
	})

	t.Run("target mismatch", func(t *testing.T) {
		pool := newRemotePool(t)
		response := remoteWebSocketRequest(
			t, user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil },
			unusedRedis, "other", remoteTestCredential,
		)
		assert.Equal(t, http.StatusForbidden, response.Code)
		require.NoError(t, pool.ExpectationsWereMet())
	})

	for _, test := range []struct {
		name  string
		allow bool
		err   error
	}{
		{name: "target lookup failure", err: assert.AnError},
		{name: "connections disabled", allow: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			expectation := pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1")
			if test.err != nil {
				expectation.WillReturnError(test.err)
			} else {
				expectation.WillReturnRows(remoteTargetRows("Mac", test.allow, false, time.Now().UTC()))
			}
			response := remoteWebSocketRequest(
				t, user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil },
				unusedRedis, "mac-1", remoteTestCredential,
			)
			assert.Equal(t, http.StatusForbidden, response.Code)
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}

	t.Run("invalid credential", func(t *testing.T) {
		pool := newRemotePool(t)
		pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").
			WillReturnRows(remoteTargetRows("Mac", true, false, time.Now().UTC()))
		response := remoteWebSocketRequest(
			t, user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil },
			unusedRedis, "mac-1", "short",
		)
		assert.Equal(t, http.StatusForbidden, response.Code)
		require.NoError(t, pool.ExpectationsWereMet())
	})

	for _, test := range []struct {
		name        string
		client      *remoteRedisStub
		resolveFail bool
		expected    int
	}{
		{name: "relay unavailable", resolveFail: true, expected: http.StatusServiceUnavailable},
		{name: "lease unavailable", client: &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "setnx", err: assert.AnError}, expected: http.StatusConflict},
		{name: "upgrade failure", client: newRemoteRedisStub(), expected: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").
				WillReturnRows(remoteTargetRows("Mac", true, false, time.Now().UTC()))
			resolveRedis := func() (redis.Cmdable, error) {
				if test.resolveFail {
					return nil, assert.AnError
				}
				return test.client, nil
			}
			response := remoteWebSocketRequest(
				t, user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil },
				resolveRedis, "mac-1", remoteTestCredential,
			)
			assert.Equal(t, test.expected, response.Code)
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

func TestRemoteWebSocketResultAndLeaseFailurePaths(t *testing.T) {
	require.Error(t, storeRemoteResult(
		t.Context(), newRemoteRedisStub(), "42", "mac-1", "command-1", "phone-1", json.RawMessage(`{`),
	))
	require.Error(t, storeWebSocketResult(
		t.Context(), newRemoteRedisStub(), "42", "mac-1", remoteWebSocketEnvelope{},
	))

	releaseClient := newRemoteRedisStub()
	releaseClient.operation = "eval"
	releaseClient.err = assert.AnError
	(&remotePollLease{client: releaseClient, keys: []string{"lease"}, token: "token"}).release(t.Context())

	refreshClient := newRemoteRedisStub()
	refreshClient.operation = "eval"
	refreshClient.err = assert.AnError
	err := (&remotePollLease{client: refreshClient, keys: []string{"lease"}, token: "token"}).refresh(t.Context())
	require.ErrorContains(t, err, "refresh remote relay lease")

	expiredClient := newRemoteRedisStub()
	expiredClient.evalResult = int64(0)
	err = (&remotePollLease{client: expiredClient, keys: []string{"lease"}, token: "token"}).refresh(t.Context())
	require.ErrorContains(t, err, "remote relay lease expired")

	activeClient := newRemoteRedisStub()
	activeClient.evalResult = int64(1)
	err = (&remotePollLease{client: activeClient, keys: []string{"device", "slot"}, token: "token"}).refresh(t.Context())
	require.NoError(t, err)
}

func TestServeRemoteWebSocketFailurePaths(t *testing.T) {
	t.Run("non-blocking Redis", func(t *testing.T) {
		err := serveRemoteWebSocketWithHeartbeat(
			t.Context(), newRemoteWebSocketConnectionStub(), nil, nonBlockingRedisStub{},
			&remotePollLease{}, "42", "mac-1", "0", time.Hour,
		)
		assert.ErrorContains(t, err, "blocking Redis stream reads are unavailable")
	})

	t.Run("context cancellation", func(t *testing.T) {
		unblock := make(chan struct{})
		client := &remoteWebSocketRedisStub{
			remoteRedisStub: newRemoteRedisStub(),
			read: func(context.Context, string, string, int64, time.Duration) ([]goredis.XMessage, error) {
				<-unblock
				return nil, nil
			},
		}
		conn := newRemoteWebSocketConnectionStub()
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		err := serveRemoteWebSocketWithHeartbeat(ctx, conn, nil, client, &remotePollLease{}, "42", "mac-1", "0", time.Hour)
		close(unblock)
		close(conn.reads)
		assert.ErrorIs(t, err, context.Canceled)
	})

	t.Run("read failure and pong deadline", func(t *testing.T) {
		readErr := errors.New("read failed")
		conn := newRemoteWebSocketConnectionStub(remoteWebSocketRead{err: readErr})
		ctx, cancel := context.WithCancel(t.Context())
		err := serveRemoteWebSocketWithHeartbeat(ctx, conn, nil, blockingRemoteWebSocketRedisStub(), &remotePollLease{}, "42", "mac-1", "0", time.Hour)
		cancel()
		close(conn.reads)
		require.ErrorIs(t, err, readErr)
		require.NotNil(t, conn.pongHandler)
		require.NoError(t, conn.pongHandler("pong"))
		assert.Equal(t, 2, conn.deadlineCalls)
	})

	for _, test := range []struct {
		name     string
		envelope remoteWebSocketEnvelope
		writeErr error
	}{
		{name: "invalid result", envelope: remoteWebSocketEnvelope{Type: "result"}},
		{
			name: "acknowledgement write failure",
			envelope: remoteWebSocketEnvelope{
				Type: "result", CommandID: "command-1", ControllerDeviceID: "phone-1",
				Response: json.RawMessage(`{"ok":true}`), LastID: "1-0",
			},
			writeErr: assert.AnError,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			conn := newRemoteWebSocketConnectionStub(remoteWebSocketRead{envelope: test.envelope})
			conn.writeJSONErr = test.writeErr
			ctx, cancel := context.WithCancel(t.Context())
			err := serveRemoteWebSocketWithHeartbeat(ctx, conn, nil, blockingRemoteWebSocketRedisStub(), &remotePollLease{}, "42", "mac-1", "0", time.Hour)
			cancel()
			close(conn.reads)
			assert.Error(t, err)
		})
	}

	t.Run("stream failure", func(t *testing.T) {
		streamErr := errors.New("stream failed")
		client := &remoteWebSocketRedisStub{
			remoteRedisStub: newRemoteRedisStub(),
			read: func(context.Context, string, string, int64, time.Duration) ([]goredis.XMessage, error) {
				return nil, streamErr
			},
		}
		conn := newRemoteWebSocketConnectionStub()
		ctx, cancel := context.WithCancel(t.Context())
		err := serveRemoteWebSocketWithHeartbeat(ctx, conn, nil, client, &remotePollLease{}, "42", "mac-1", "0", time.Hour)
		cancel()
		close(conn.reads)
		assert.ErrorIs(t, err, streamErr)
	})

	t.Run("command write failure", func(t *testing.T) {
		pool := newRemotePool(t)
		pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1").
			WillReturnRows(pgxmock.NewRows([]string{"active"}).AddRow(true))
		client := &remoteWebSocketRedisStub{
			remoteRedisStub: newRemoteRedisStub(),
			read: func(context.Context, string, string, int64, time.Duration) ([]goredis.XMessage, error) {
				return []goredis.XMessage{{
					ID: "1-0", Values: map[string]any{"command": fmt.Sprintf(`{"id":"command-1","controllerDeviceId":"phone-1","createdAt":%q}`, time.Now().UTC().Format(time.RFC3339Nano))},
				}}, nil
			},
		}
		conn := newRemoteWebSocketConnectionStub()
		conn.writeJSONErr = assert.AnError
		ctx, cancel := context.WithCancel(t.Context())
		err := serveRemoteWebSocketWithHeartbeat(ctx, conn, db.New(pool), client, &remotePollLease{}, "42", "mac-1", "0", time.Hour)
		cancel()
		close(conn.reads)
		require.ErrorIs(t, err, assert.AnError)
		require.NoError(t, pool.ExpectationsWereMet())
	})

	t.Run("heartbeat refresh failure", func(t *testing.T) {
		leaseClient := newRemoteRedisStub()
		leaseClient.operation = "eval"
		leaseClient.err = assert.AnError
		conn := newRemoteWebSocketConnectionStub()
		ctx, cancel := context.WithCancel(t.Context())
		err := serveRemoteWebSocketWithHeartbeat(
			ctx, conn, nil, blockingRemoteWebSocketRedisStub(),
			&remotePollLease{client: leaseClient, keys: []string{"lease"}, token: "token"},
			"42", "mac-1", "0", time.Millisecond,
		)
		cancel()
		close(conn.reads)
		assert.ErrorContains(t, err, "refresh remote relay lease")
	})

	t.Run("heartbeat write failure", func(t *testing.T) {
		pool := newRemotePool(t)
		pool.ExpectExec("UPDATE remote_targets").WithArgs("42", "mac-1").
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		leaseClient := newRemoteRedisStub()
		leaseClient.evalResult = int64(1)
		conn := newRemoteWebSocketConnectionStub()
		conn.writeControlErr = assert.AnError
		ctx, cancel := context.WithCancel(t.Context())
		err := serveRemoteWebSocketWithHeartbeat(
			ctx, conn, db.New(pool), blockingRemoteWebSocketRedisStub(),
			&remotePollLease{client: leaseClient, keys: []string{"lease"}, token: "token"},
			"42", "mac-1", "0", time.Millisecond,
		)
		cancel()
		close(conn.reads)
		require.ErrorIs(t, err, assert.AnError)
		require.NoError(t, pool.ExpectationsWereMet())
	})
}

var _ remoteWebSocketConnection = (*remoteWebSocketConnectionStub)(nil)
