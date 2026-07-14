package developer

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	devhandler "github.com/TaskForceAI/developer-service/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUsage_KeysDbError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(dbtest.DeveloperBillingUser(1, "test@example.com", 100)))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetUsage_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	usageUser := dbtest.DeveloperBillingUser(1, "test@example.com", 100)
	usageUser.APIRequestsUsed = 5
	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(usageUser))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_1234",
			Tier: "STARTER", HandlerStyle: true,
		}))

	mock.ExpectQuery("SELECT key_ids.api_key_id").
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{"api_key_id", "hourly_count", "daily_count", "weekly_count", "monthly_count"}).AddRow(int32(1), int32(0), int32(0), int32(0), int32(0)))

	mock.ExpectQuery("SELECT .* FROM developer_api_usage").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "api_key_id", "window_start", "window_end", "count", "endpoint", "status_code", "response_time", "timestamp", "created_at", "updated_at"}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetUsage_Unauthorized(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGetUsage_UserIDTooLarge(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)
	q := db.New(mock)
	RegisterUsageHandler(api, q)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "2147483648")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetUsage_UserNotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(pgx.ErrNoRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestListKeys_DbError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/keys", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListKeys_GetQueriesError(t *testing.T) {
	origGetQueries := devhandler.GetQueries
	defer func() { devhandler.GetQueries = origGetQueries }()
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)
	RegisterKeysHandlers(api, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/keys", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestListKeys_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_1234",
			Tier: "STARTER", HandlerStyle: true,
		}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/keys", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &payload))
	keys, ok := payload["keys"].([]any)
	require.True(t, ok)
	require.Len(t, keys, 1)

	firstKey, ok := keys[0].(map[string]any)
	require.True(t, ok)
	_, hasKeyID := firstKey["keyId"]
	assert.True(t, hasKeyID)
	_, hasLegacyID := firstKey["ID"]
	assert.False(t, hasLegacyID)
}

func TestListKeys_Unauthorized(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/keys", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRevokeKey_AlreadyRevoked(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	revokedAt := time.Now()
	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 123, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_123",
			Tier: "STARTER", RevokedAt: revokedAt, HandlerStyle: true,
		}))

	body := map[string]int{"keyId": 123}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRevokeKey_DbError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(assert.AnError)

	body := map[string]int{"keyId": 123}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestRevokeKey_GetQueriesError(t *testing.T) {
	origGetQueries := devhandler.GetQueries
	defer func() { devhandler.GetQueries = origGetQueries }()
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)
	RegisterKeysHandlers(api, nil)

	body := map[string]int{"keyId": 123}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestRevokeKey_InvalidKeyID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	body := map[string]int{"keyId": 0}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRevokeKey_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(dbtest.APIKeyColumns()))

	body := map[string]int{"keyId": 999}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestRevokeKey_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 123, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_123",
			Tier: "STARTER", HandlerStyle: true,
		}))

	mock.ExpectExec("UPDATE developer_api_keys").
		WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	body := map[string]int{"keyId": 123}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRevokeKey_Unauthorized(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	body := map[string]int{"keyId": 123}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRevokeKey_WithEmailNotification(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key")
	revoked := make(chan developerEmailCall, 1)
	previousEmailService := newDeveloperEmailService
	newDeveloperEmailService = func() developerKeyEmailService {
		return &recordingDeveloperKeyEmailService{revoked: revoked}
	}
	t.Cleanup(func() { newDeveloperEmailService = previousEmailService })

	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 123, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_123",
			Tier: "STARTER", HandlerStyle: true,
		}))

	mock.ExpectExec("UPDATE developer_api_keys").
		WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	body := map[string]int{"keyId": 123}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	select {
	case call := <-revoked:
		require.NoError(t, call.ctxErr)
		assert.Equal(t, "test@example.com", call.to)
		assert.Equal(t, "test@example.com", call.displayName)
		assert.Equal(t, "tfai_123", call.keyName)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for API key revoked email")
	}
}

func TestSqlcDeveloperAccountLookup_GetUserByID_InvalidTimestamps(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "test@example.com", Baseline: dbtest.BaselineBilling,
			PaymentsStyle: true, APIRequestsLimit: 100,
		}))

	row, err := account.NewIDStore(db.New(mock)).GetByID(context.Background(), 1)
	require.NoError(t, err)
	assert.Nil(t, row.APICurrentPeriodStart)
	assert.Nil(t, row.APICurrentPeriodEnd)
}
