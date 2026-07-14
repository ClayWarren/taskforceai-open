package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type remoteRedisStub struct {
	redis.Cmdable
	data       map[string]string
	messages   []goredis.XMessage
	operation  string
	err        error
	challenge  string
	evalResult any
	blockWait  time.Duration
	setNXCalls int
	setNXErrAt int
}

type nonBlockingRedisStub struct {
	redis.Cmdable
}

type blockingRemoteRedisStub struct {
	*remoteRedisStub
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (s *blockingRemoteRedisStub) XReadBlock(ctx context.Context, stream string, lastID string, count int64, block time.Duration) ([]goredis.XMessage, error) {
	s.once.Do(func() { close(s.started) })
	select {
	case <-s.release:
		return s.XRead(ctx, stream, lastID, count)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

const remoteTestCredential = "remote-test-device-credential-0000000000000000000000000000"

func newRemotePool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	pool := dbtest.NewMockPoolRegexp(t)
	pool.MatchExpectationsInOrder(false)
	digest := deviceCredentialHash(remoteTestCredential)
	pool.ExpectExec("INSERT INTO remote_device_credentials").
		WithArgs("42", pgxmock.AnyArg(), digest).
		WillReturnResult(pgxmock.NewResult("INSERT", 1)).
		Maybe().Times(100)
	for range 100 {
		pool.ExpectQuery("SELECT credential_hash").
			WithArgs("42", pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{"credential_hash"}).AddRow(digest)).
			Maybe()
	}
	return pool
}

func newRemoteRedisStub() *remoteRedisStub {
	return &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}}
}

func (s *remoteRedisStub) Set(_ context.Context, key string, value []byte, _ time.Duration) error {
	if s.operation == "set" && s.err != nil {
		return s.err
	}
	s.data[key] = string(value)
	if strings.HasPrefix(key, "remote:pairing:") {
		s.challenge = string(value)
	}
	return nil
}

func (s *remoteRedisStub) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	s.setNXCalls++
	if s.operation == "setnx" && s.err != nil && (s.setNXErrAt == 0 || s.setNXCalls == s.setNXErrAt) {
		return false, s.err
	}
	if _, exists := s.data[key]; exists {
		return false, nil
	}
	s.data[key] = string(value)
	return true, nil
}

func (s *remoteRedisStub) Del(_ context.Context, key string) (bool, error) {
	_, exists := s.data[key]
	delete(s.data, key)
	return exists, nil
}

func (s *remoteRedisStub) Get(_ context.Context, key string) (string, error) {
	if s.operation == "get" && s.err != nil {
		return "", s.err
	}
	value, ok := s.data[key]
	if !ok {
		return "", redis.ErrKeyNotFound
	}
	return value, nil
}

func (s *remoteRedisStub) XAdd(_ context.Context, _ string, values map[string]any) (string, error) {
	if s.operation == "xadd" && s.err != nil {
		return "", s.err
	}
	s.messages = append(s.messages, goredis.XMessage{ID: "1-0", Values: values})
	return "1-0", nil
}

func (s *remoteRedisStub) XRead(_ context.Context, _ string, _ string, _ int64) ([]goredis.XMessage, error) {
	if s.operation == "xread" && s.err != nil {
		return nil, s.err
	}
	return s.messages, nil
}

func (s *remoteRedisStub) XReadBlock(ctx context.Context, stream string, lastID string, count int64, block time.Duration) ([]goredis.XMessage, error) {
	s.blockWait = block
	return s.XRead(ctx, stream, lastID, count)
}

func (s *remoteRedisStub) XTrimMaxLen(context.Context, string, int64) (int64, error) {
	return 0, nil
}

func (s *remoteRedisStub) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if s.operation == "eval" && s.err != nil {
		cmd.SetErr(s.err)
		return cmd
	}
	if len(keys) == 2 && strings.Contains(script, `KEYS[2]`) {
		if s.data[keys[1]] != fmt.Sprint(args[0]) {
			cmd.SetVal(int64(0))
			return cmd
		}
		delete(s.data, keys[0])
		delete(s.data, keys[1])
		cmd.SetVal(int64(1))
		return cmd
	}
	if strings.Contains(script, `redis.call("del", KEYS[1])`) {
		if s.data[keys[0]] != fmt.Sprint(args[0]) {
			cmd.SetVal(int64(0))
			return cmd
		}
		delete(s.data, keys[0])
		cmd.SetVal(int64(1))
		return cmd
	}
	if s.evalResult != nil {
		cmd.SetVal(s.evalResult)
		return cmd
	}
	if s.challenge == "" {
		cmd.SetErr(goredis.Nil)
		return cmd
	}
	var challenge pairingChallenge
	if json.Unmarshal([]byte(s.challenge), &challenge) != nil || challenge.UserID != args[0] {
		cmd.SetVal("__REMOTE_ACCOUNT_MISMATCH__")
		return cmd
	}
	cmd.SetVal(s.challenge)
	s.challenge = ""
	return cmd
}

func setupRemoteAPI(
	user *adapterauth.AuthenticatedUser,
	resolveQueries QueriesResolver,
	resolveRedis RedisResolver,
) *chi.Mux {
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if user != nil {
				request = request.WithContext(context.WithValue(request.Context(), adapterhandler.UserContextKey, user))
			}
			next.ServeHTTP(writer, request)
		})
	})
	api := humachi.New(router, huma.DefaultConfig("Remote test", "1.0"))
	RegisterHandlers(api, resolveQueries, resolveRedis)
	return router
}

func remoteRequest(t *testing.T, router http.Handler, method, path, deviceID, body string) *httptest.ResponseRecorder {
	return remoteRequestWithCredential(t, router, method, path, deviceID, remoteTestCredential, body)
}

func remoteRequestWithCredential(t *testing.T, router http.Handler, method, path, deviceID, credential, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	if deviceID != "" {
		request.Header.Set("X-Device-Id", deviceID)
	}
	request.Header.Set("X-Device-Credential", credential)
	request.Header.Set("User-Agent", "Remote test agent")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestRemoteHandlersRejectInvalidDeviceCredentials(t *testing.T) {
	now := time.Now().UTC()
	user := &adapterauth.AuthenticatedUser{ID: 42}
	tests := []struct {
		name    string
		method  string
		path    string
		device  string
		body    string
		prepare func(pgxmock.PgxPoolIface, *remoteRedisStub)
	}{
		{"target", http.MethodPut, "/api/v1/remote/target", "mac-1", `{"deviceName":"Mac","allowConnections":true,"keepAwake":false}`, nil},
		{"pairing code", http.MethodPost, "/api/v1/remote/pairing-code", "mac-1", `{"deviceName":"Mac"}`, nil},
		{"pair", http.MethodPost, "/api/v1/remote/pair", "phone-1", `{"code":"ABCD-EFGH","deviceName":"Phone"}`, nil},
		{"connections", http.MethodGet, "/api/v1/remote/connections", "phone-1", "", nil},
		{"controllers", http.MethodGet, "/api/v1/remote/controllers", "mac-1", "", nil},
		{"revoke", http.MethodDelete, "/api/v1/remote/controllers/phone-1", "mac-1", "", nil},
		{"rpc", http.MethodPost, "/api/v1/remote/devices/mac-1/rpc", "phone-1", `{"request":{"jsonrpc":"2.0"}}`, nil},
		{"command poll", http.MethodGet, "/api/v1/remote/devices/mac-1/commands", "mac-1", "", func(pool pgxmock.PgxPoolIface, _ *remoteRedisStub) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		}},
		{"result put", http.MethodPut, "/api/v1/remote/devices/mac-1/commands/cmd/result", "mac-1", `{"response":{"controllerDeviceId":"phone-1","response":{}}}`, nil},
		{"result get", http.MethodGet, "/api/v1/remote/devices/mac-1/commands/cmd/result", "phone-1", "", nil},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			client := newRemoteRedisStub()
			if test.prepare != nil {
				test.prepare(pool, client)
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, func() (redis.Cmdable, error) { return client, nil })
			response := remoteRequestWithCredential(t, router, test.method, test.path, test.device, "short", test.body)
			assert.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

func TestRemoteDeviceCredentialDatabaseFailures(t *testing.T) {
	credential := strings.Repeat("c", 64)
	digest := deviceCredentialHash(credential)

	t.Run("claim failure", func(t *testing.T) {
		pool := dbtest.NewMockPoolRegexp(t)
		pool.ExpectExec("INSERT INTO remote_device_credentials").WithArgs("42", "phone-1", digest).WillReturnError(assert.AnError)
		err := claimDeviceCredential(context.Background(), db.New(pool), "42", "phone-1", credential)
		require.Error(t, err)
		require.NoError(t, pool.ExpectationsWereMet())
	})

	for _, test := range []struct {
		name string
		err  error
	}{
		{"missing credential", pgx.ErrNoRows},
		{"lookup failure", assert.AnError},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := dbtest.NewMockPoolRegexp(t)
			pool.ExpectQuery("SELECT credential_hash").WithArgs("42", "phone-1").WillReturnError(test.err)
			err := compareDeviceCredential(context.Background(), db.New(pool), "42", "phone-1", digest)
			require.Error(t, err)
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

func syncDeviceRows(name, deviceID string, now time.Time) *pgxmock.Rows {
	userAgent := "Remote test agent"
	timestamp := pgtype.Timestamp{Time: now, Valid: true}
	return pgxmock.NewRows([]string{"id", "user_id", "device_id", "device_name", "user_agent", "last_seen_at", "created_at", "is_revoked"}).
		AddRow(int32(1), "42", deviceID, &name, &userAgent, timestamp, timestamp, false)
}

func remoteTargetRows(name string, allow, keepAwake bool, now time.Time) *pgxmock.Rows {
	timestamp := pgtype.Timestamp{Time: now, Valid: true}
	return pgxmock.NewRows([]string{"id", "user_id", "device_id", "device_name", "allow_connections", "keep_awake", "last_seen_at", "created_at", "updated_at"}).
		AddRow(int32(1), "42", "mac-1", name, allow, keepAwake, timestamp, timestamp, timestamp)
}

func remoteConnectionRows(now time.Time) *pgxmock.Rows {
	timestamp := pgtype.Timestamp{Time: now, Valid: true}
	return pgxmock.NewRows([]string{"id", "user_id", "target_device_id", "controller_device_id", "capabilities", "created_at", "last_used_at", "revoked_at"}).
		AddRow(int32(1), "42", "mac-1", "phone-1", []string{"rpc"}, timestamp, timestamp, pgtype.Timestamp{})
}

func TestRemoteHandlersSuccessFlow(t *testing.T) {
	now := time.Now().UTC()
	pool := newRemotePool(t)
	queries := db.New(pool)
	client := newRemoteRedisStub()
	resolveQueries := func(context.Context) (*db.Queries, error) { return queries, nil }
	resolveRedis := func() (redis.Cmdable, error) { return client, nil }
	router := setupRemoteAPI(&adapterauth.AuthenticatedUser{ID: 42, Email: "user@example.com"}, resolveQueries, resolveRedis)

	pool.ExpectQuery("INSERT INTO sync_devices").WithArgs("42", "mac-1", pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnRows(syncDeviceRows("Studio Mac", "mac-1", now))
	pool.ExpectQuery("INSERT INTO remote_targets").WithArgs("42", "mac-1", "Studio Mac", true, true).WillReturnRows(remoteTargetRows("Studio Mac", true, true, now))
	response := remoteRequest(t, router, http.MethodPut, "/api/v1/remote/target", "mac-1", `{"deviceName":" Studio Mac ","allowConnections":true,"keepAwake":true}`)
	if response.Code != http.StatusOK {
		t.Log(pool.ExpectationsWereMet())
	}
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Studio Mac", true, true, now))
	response = remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pairing-code", "mac-1", `{"deviceName":"Studio Mac"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var codeBody struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &codeBody))
	require.NotEmpty(t, codeBody.Code)

	pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Studio Mac", true, true, now))
	pool.ExpectQuery("INSERT INTO sync_devices").WithArgs("42", "phone-1", pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnRows(syncDeviceRows("Phone", "phone-1", now))
	pool.ExpectQuery("INSERT INTO remote_connections").WithArgs("42", "mac-1", "phone-1").WillReturnRows(remoteConnectionRows(now))
	response = remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pair", "phone-1", `{"code":"`+codeBody.Code+`","deviceName":" Phone "}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	pool.ExpectQuery("SELECT (.+) FROM remote_connections").WithArgs("42", "phone-1").WillReturnRows(
		pgxmock.NewRows([]string{"id", "user_id", "target_device_id", "controller_device_id", "capabilities", "created_at", "last_used_at", "revoked_at", "target_name", "allow_connections", "keep_awake", "target_last_seen_at"}).
			AddRow(int32(1), "42", "mac-1", "phone-1", []string{"rpc"}, pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{}, "Studio Mac", true, true, pgtype.Timestamp{Time: now, Valid: true}),
	)
	response = remoteRequest(t, router, http.MethodGet, "/api/v1/remote/connections", "phone-1", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "Studio Mac")

	controllerName := " Tablet "
	controllerAgent := " Agent "
	timestamp := pgtype.Timestamp{Time: now, Valid: true}
	pool.ExpectQuery("SELECT (.+) FROM remote_connections").WithArgs("42", "mac-1").WillReturnRows(
		pgxmock.NewRows([]string{"id", "user_id", "target_device_id", "controller_device_id", "capabilities", "created_at", "last_used_at", "revoked_at", "controller_name", "controller_user_agent", "controller_last_seen_at"}).
			AddRow(int32(1), "42", "mac-1", "phone-1", []string{"rpc"}, timestamp, timestamp, pgtype.Timestamp{}, nil, nil, timestamp).
			AddRow(int32(2), "42", "mac-1", "tablet-1", []string{}, timestamp, timestamp, pgtype.Timestamp{}, &controllerName, &controllerAgent, timestamp),
	)
	response = remoteRequest(t, router, http.MethodGet, "/api/v1/remote/controllers", "mac-1", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "Mobile device")

	pool.ExpectExec("UPDATE remote_connections").WithArgs("42", "mac-1", "phone-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	response = remoteRequest(t, router, http.MethodDelete, "/api/v1/remote/controllers/phone-1", "mac-1", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1").WillReturnRows(pgxmock.NewRows([]string{"active"}).AddRow(true))
	pool.ExpectExec("UPDATE remote_connections").WithArgs("42", "mac-1", "phone-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	response = remoteRequest(t, router, http.MethodPost, "/api/v1/remote/devices/mac-1/rpc", "phone-1", `{"request":{"jsonrpc":"2.0","id":1,"method":"server.ping"}}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var commandBody struct {
		CommandID string `json:"commandId"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &commandBody))
	require.Len(t, commandBody.CommandID, 32)

	client.messages = append([]goredis.XMessage{{ID: "0-1", Values: map[string]any{"command": "not-json"}}}, client.messages...)
	pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Studio Mac", true, true, now))
	pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1").WillReturnRows(pgxmock.NewRows([]string{"active"}).AddRow(true))
	response = remoteRequest(t, router, http.MethodGet, "/api/v1/remote/devices/mac-1/commands?lastId=&waitMs=5000", "mac-1", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), commandBody.CommandID)
	assert.Equal(t, 5*time.Second, client.blockWait)

	resultEnvelope := `{"controllerDeviceId":"phone-1","response":{"jsonrpc":"2.0","id":1,"result":{"ok":true}}}`
	response = remoteRequest(t, router, http.MethodPut, "/api/v1/remote/devices/mac-1/commands/"+commandBody.CommandID+"/result", "mac-1", `{"response":`+resultEnvelope+`}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1").WillReturnRows(pgxmock.NewRows([]string{"active"}).AddRow(true))
	response = remoteRequest(t, router, http.MethodGet, "/api/v1/remote/devices/mac-1/commands/"+commandBody.CommandID+"/result", "phone-1", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), `"status":"complete"`)

	require.NoError(t, pool.ExpectationsWereMet())
}

func TestRemoteHandlerDependencyAndHelperEdges(t *testing.T) {
	queries := func(context.Context) (*db.Queries, error) { return nil, errors.New("database unavailable") }
	redisResolver := func() (redis.Cmdable, error) { return nil, errors.New("redis unavailable") }
	paths := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPut, "/api/v1/remote/target", `{"deviceName":"Mac","allowConnections":false,"keepAwake":false}`},
		{http.MethodPost, "/api/v1/remote/pairing-code", `{"deviceName":"Mac"}`},
		{http.MethodPost, "/api/v1/remote/pair", `{"code":"ABCD-EFGH","deviceName":"Phone"}`},
		{http.MethodGet, "/api/v1/remote/connections", ""},
		{http.MethodGet, "/api/v1/remote/controllers", ""},
		{http.MethodDelete, "/api/v1/remote/controllers/phone-1", ""},
		{http.MethodPost, "/api/v1/remote/devices/mac-1/rpc", `{"request":{"jsonrpc":"2.0"}}`},
		{http.MethodGet, "/api/v1/remote/devices/mac-1/commands", ""},
		{http.MethodPut, "/api/v1/remote/devices/mac-1/commands/cmd/result", `{"response":{"jsonrpc":"2.0"}}`},
		{http.MethodGet, "/api/v1/remote/devices/mac-1/commands/cmd/result", ""},
	}

	for _, test := range paths {
		response := remoteRequest(t, setupRemoteAPI(&adapterauth.AuthenticatedUser{ID: 42}, queries, redisResolver), test.method, test.path, "device-1", test.body)
		assert.Equal(t, http.StatusServiceUnavailable, response.Code, test.path+": "+response.Body.String())
	}

	unauthorized := remoteRequest(t, setupRemoteAPI(nil, queries, redisResolver), http.MethodGet, "/api/v1/remote/connections", "device-1", "")
	assert.Equal(t, http.StatusUnauthorized, unauthorized.Code)
	zeroUser := remoteRequest(t, setupRemoteAPI(&adapterauth.AuthenticatedUser{}, queries, redisResolver), http.MethodGet, "/api/v1/remote/connections", "device-1", "")
	assert.Equal(t, http.StatusUnauthorized, zeroUser.Code)
	assert.Nil(t, optionalString("  "))
	assert.Equal(t, "value", *optionalString(" value "))
	assert.Equal(t, "fallback", valueOr(nil, "fallback"))
	empty := "  "
	assert.Equal(t, "fallback", valueOr(&empty, "fallback"))
	value := " value "
	assert.Equal(t, value, valueOr(&value, "fallback"))
	now := time.Now()
	converted := targetFromRow(db.RemoteTarget{DeviceID: "mac", DeviceName: "Mac", AllowConnections: true, KeepAwake: true, LastSeenAt: pgtype.Timestamp{Time: now, Valid: true}})
	assert.Equal(t, now, converted.LastSeenAt)
	assert.Equal(t, "remote:pairing:ABCDEFGH", pairingKey(" abcd-efgh "))
	hexValue, err := randomHex(4)
	require.NoError(t, err)
	assert.Len(t, hexValue, 8)
}

func TestRemoteTargetAndListFailurePaths(t *testing.T) {
	now := time.Now().UTC()
	client := newRemoteRedisStub()
	redisResolver := func() (redis.Cmdable, error) {
		if client.operation == "resolve" {
			return nil, client.err
		}
		return client, nil
	}
	user := &adapterauth.AuthenticatedUser{ID: 42}

	t.Run("target validation and database failures", func(t *testing.T) {
		pool := newRemotePool(t)
		router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, redisResolver)
		response := remoteRequest(t, router, http.MethodPut, "/api/v1/remote/target", "", `{"deviceName":"Mac","allowConnections":true,"keepAwake":false}`)
		assert.Equal(t, http.StatusBadRequest, response.Code)

		pool.ExpectQuery("INSERT INTO sync_devices").WithArgs("42", "mac-1", pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnError(assert.AnError)
		response = remoteRequest(t, router, http.MethodPut, "/api/v1/remote/target", "mac-1", `{"deviceName":"Mac","allowConnections":true,"keepAwake":false}`)
		assert.Equal(t, http.StatusInternalServerError, response.Code)

		pool.ExpectQuery("INSERT INTO sync_devices").WithArgs("42", "mac-1", pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnRows(syncDeviceRows("Mac", "mac-1", now))
		pool.ExpectQuery("INSERT INTO remote_targets").WithArgs("42", "mac-1", "Mac", true, false).WillReturnError(assert.AnError)
		response = remoteRequest(t, router, http.MethodPut, "/api/v1/remote/target", "mac-1", `{"deviceName":"Mac","allowConnections":true,"keepAwake":false}`)
		assert.Equal(t, http.StatusInternalServerError, response.Code)
		require.NoError(t, pool.ExpectationsWereMet())
	})

	for _, test := range []struct {
		name        string
		method      string
		path        string
		deviceID    string
		query       string
		queryArgs   []any
		expected    int
		execFailure bool
	}{
		{"connections invalid device", http.MethodGet, "/api/v1/remote/connections", "", "", nil, http.StatusBadRequest, false},
		{"connections query failure", http.MethodGet, "/api/v1/remote/connections", "phone-1", "SELECT (.+) FROM remote_connections", []any{"42", "phone-1"}, http.StatusInternalServerError, false},
		{"controllers invalid device", http.MethodGet, "/api/v1/remote/controllers", "", "", nil, http.StatusBadRequest, false},
		{"controllers query failure", http.MethodGet, "/api/v1/remote/controllers", "mac-1", "SELECT (.+) FROM remote_connections", []any{"42", "mac-1"}, http.StatusInternalServerError, false},
		{"revoke invalid target", http.MethodDelete, "/api/v1/remote/controllers/phone-1", "", "", nil, http.StatusBadRequest, false},
		{"revoke database failure", http.MethodDelete, "/api/v1/remote/controllers/phone-1", "mac-1", "UPDATE remote_connections", []any{"42", "mac-1", "phone-1"}, http.StatusInternalServerError, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			if test.query != "" {
				if test.execFailure {
					pool.ExpectExec(test.query).WithArgs(test.queryArgs...).WillReturnError(assert.AnError)
				} else {
					pool.ExpectQuery(test.query).WithArgs(test.queryArgs...).WillReturnError(assert.AnError)
				}
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, redisResolver)
			response := remoteRequest(t, router, test.method, test.path, test.deviceID, "")
			assert.Equal(t, test.expected, response.Code, response.Body.String())
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

func TestRemotePairingFailurePaths(t *testing.T) {
	now := time.Now().UTC()
	user := &adapterauth.AuthenticatedUser{ID: 42}
	pairingBody := `{"code":"ABCD-EFGH","deviceName":"Phone"}`

	t.Run("pairing code failures", func(t *testing.T) {
		pool := newRemotePool(t)
		client := newRemoteRedisStub()
		queries := func(context.Context) (*db.Queries, error) { return db.New(pool), nil }
		router := setupRemoteAPI(user, queries, func() (redis.Cmdable, error) { return client, nil })
		assert.Equal(t, http.StatusBadRequest, remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pairing-code", "", `{"deviceName":"Mac"}`).Code)

		pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", false, false, now))
		assert.Equal(t, http.StatusConflict, remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pairing-code", "mac-1", `{"deviceName":"Mac"}`).Code)

		pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		unavailableRouter := setupRemoteAPI(user, queries, func() (redis.Cmdable, error) { return nil, assert.AnError })
		assert.Equal(t, http.StatusServiceUnavailable, remoteRequest(t, unavailableRouter, http.MethodPost, "/api/v1/remote/pairing-code", "mac-1", `{"deviceName":"Mac"}`).Code)

		pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		originalRead := readRandom
		readRandom = func([]byte) (int, error) { return 0, assert.AnError }
		assert.Equal(t, http.StatusInternalServerError, remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pairing-code", "mac-1", `{"deviceName":"Mac"}`).Code)
		readRandom = originalRead

		pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		client.operation, client.err = "set", assert.AnError
		assert.Equal(t, http.StatusServiceUnavailable, remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pairing-code", "mac-1", `{"deviceName":"Mac"}`).Code)
		require.NoError(t, pool.ExpectationsWereMet())
	})

	for _, test := range []struct {
		name       string
		deviceID   string
		client     *remoteRedisStub
		redisError bool
		prepareDB  func(pgxmock.PgxPoolIface)
		expected   int
	}{
		{"invalid controller", "", newRemoteRedisStub(), false, nil, http.StatusBadRequest},
		{"relay unavailable", "phone-1", newRemoteRedisStub(), true, nil, http.StatusServiceUnavailable},
		{"expired code", "phone-1", newRemoteRedisStub(), false, nil, http.StatusGone},
		{"account mismatch", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, evalResult: "__REMOTE_ACCOUNT_MISMATCH__"}, false, nil, http.StatusForbidden},
		{"relay read failure", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "get", err: assert.AnError}, false, nil, http.StatusServiceUnavailable},
		{"non string challenge", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, evalResult: 7}, false, nil, http.StatusGone},
		{"invalid challenge", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, evalResult: "not-json"}, false, nil, http.StatusForbidden},
		{"target disabled", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, evalResult: `{"userId":"42","targetDeviceId":"mac-1"}`}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", false, false, now))
		}, http.StatusConflict},
		{"controller registration failure", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, evalResult: `{"userId":"42","targetDeviceId":"mac-1"}`}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
			pool.ExpectQuery("INSERT INTO sync_devices").WithArgs("42", "phone-1", pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnError(assert.AnError)
		}, http.StatusInternalServerError},
		{"connection save failure", "phone-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, evalResult: `{"userId":"42","targetDeviceId":"mac-1"}`}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
			pool.ExpectQuery("INSERT INTO sync_devices").WithArgs("42", "phone-1", pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnRows(syncDeviceRows("Phone", "phone-1", now))
			pool.ExpectQuery("INSERT INTO remote_connections").WithArgs("42", "mac-1", "phone-1").WillReturnError(assert.AnError)
		}, http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			if test.prepareDB != nil {
				test.prepareDB(pool)
			}
			if raw, ok := test.client.evalResult.(string); ok {
				if raw == "__REMOTE_ACCOUNT_MISMATCH__" {
					raw = `{"userId":"other","targetDeviceId":"mac-1"}`
				}
				test.client.data[pairingKey("ABCD-EFGH")] = raw
			}
			redisResolver := func() (redis.Cmdable, error) {
				if test.redisError {
					return nil, assert.AnError
				}
				return test.client, nil
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, redisResolver)
			response := remoteRequest(t, router, http.MethodPost, "/api/v1/remote/pair", test.deviceID, pairingBody)
			assert.Equal(t, test.expected, response.Code, response.Body.String())
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

func TestRemoteRPCFailurePaths(t *testing.T) {
	user := &adapterauth.AuthenticatedUser{ID: 42}
	body := `{"request":{"jsonrpc":"2.0","id":1,"method":"server.ping"}}`

	for _, test := range []struct {
		name      string
		deviceID  string
		body      string
		active    any
		redisErr  error
		client    *remoteRedisStub
		randomErr bool
		expected  int
	}{
		{"invalid controller", "", body, nil, nil, newRemoteRedisStub(), false, http.StatusBadRequest},
		{"missing request", "phone-1", `{}`, nil, nil, newRemoteRedisStub(), false, http.StatusUnprocessableEntity},
		{"inactive connection", "phone-1", body, false, nil, newRemoteRedisStub(), false, http.StatusForbidden},
		{"connection lookup failure", "phone-1", body, assert.AnError, nil, newRemoteRedisStub(), false, http.StatusForbidden},
		{"relay unavailable", "phone-1", body, true, assert.AnError, newRemoteRedisStub(), false, http.StatusServiceUnavailable},
		{"command id failure", "phone-1", body, true, nil, newRemoteRedisStub(), true, http.StatusInternalServerError},
		{"enqueue failure", "phone-1", body, true, nil, &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "xadd", err: assert.AnError}, false, http.StatusServiceUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			if test.active != nil {
				expectation := pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1")
				if lookupErr, ok := test.active.(error); ok {
					expectation.WillReturnError(lookupErr)
				} else {
					expectation.WillReturnRows(pgxmock.NewRows([]string{"active"}).AddRow(test.active))
				}
			}
			if test.randomErr {
				originalRead := readRandom
				readRandom = func([]byte) (int, error) { return 0, assert.AnError }
				t.Cleanup(func() { readRandom = originalRead })
			}
			resolveRedis := func() (redis.Cmdable, error) {
				if test.redisErr != nil {
					return nil, test.redisErr
				}
				return test.client, nil
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, resolveRedis)
			response := remoteRequest(t, router, http.MethodPost, "/api/v1/remote/devices/mac-1/rpc", test.deviceID, test.body)
			assert.Equal(t, test.expected, response.Code, response.Body.String())
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

func TestRemoteCommandPollFailurePaths(t *testing.T) {
	user := &adapterauth.AuthenticatedUser{ID: 42}
	now := time.Now().UTC()

	for _, test := range []struct {
		name       string
		deviceID   string
		client     redis.Cmdable
		redisError bool
		prepareDB  func(pgxmock.PgxPoolIface)
		path       string
		expected   int
	}{
		{"target mismatch", "other", newRemoteRedisStub(), false, nil, "/api/v1/remote/devices/mac-1/commands", http.StatusForbidden},
		{"target disabled", "mac-1", newRemoteRedisStub(), false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", false, false, now))
		}, "/api/v1/remote/devices/mac-1/commands", http.StatusForbidden},
		{"relay unavailable", "mac-1", newRemoteRedisStub(), true, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		}, "/api/v1/remote/devices/mac-1/commands", http.StatusServiceUnavailable},
		{"blocking read unsupported", "mac-1", &nonBlockingRedisStub{Cmdable: redis.NewMockClient()}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		}, "/api/v1/remote/devices/mac-1/commands?waitMs=5000", http.StatusServiceUnavailable},
		{"poll lease unavailable", "mac-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "setnx", err: assert.AnError}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
		}, "/api/v1/remote/devices/mac-1/commands?waitMs=5000", http.StatusServiceUnavailable},
		{"stream failure", "mac-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, operation: "xread", err: assert.AnError}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now.Add(-time.Minute)))
			pool.ExpectExec("UPDATE remote_targets").WithArgs("42", "mac-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		}, "/api/v1/remote/devices/mac-1/commands", http.StatusServiceUnavailable},
		{"inactive command is filtered", "mac-1", &remoteRedisStub{Cmdable: redis.NewMockClient(), data: map[string]string{}, messages: []goredis.XMessage{{ID: "2-0", Values: map[string]any{"command": fmt.Sprintf(`{"id":"cmd","controllerDeviceId":"phone-1","request":{},"createdAt":%q}`, now.Format(time.RFC3339Nano))}}}}, false, func(pool pgxmock.PgxPoolIface) {
			pool.ExpectQuery("SELECT (.+) FROM remote_targets").WithArgs("42", "mac-1").WillReturnRows(remoteTargetRows("Mac", true, false, now))
			for range 2 {
				pool.ExpectExec("UPDATE remote_targets").WithArgs("42", "mac-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
			}
			pool.ExpectQuery("SELECT EXISTS").WithArgs("42", "mac-1", "phone-1").WillReturnError(assert.AnError)
		}, "/api/v1/remote/devices/mac-1/commands?lastId=%20", http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := newRemotePool(t)
			if test.prepareDB != nil {
				test.prepareDB(pool)
			}
			resolveRedis := func() (redis.Cmdable, error) {
				if test.redisError {
					return nil, assert.AnError
				}
				return test.client, nil
			}
			router := setupRemoteAPI(user, func(context.Context) (*db.Queries, error) { return db.New(pool), nil }, resolveRedis)
			response := remoteRequest(t, router, http.MethodGet, test.path, test.deviceID, "")
			assert.Equal(t, test.expected, response.Code, response.Body.String())
			require.NoError(t, pool.ExpectationsWereMet())
		})
	}
}

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
