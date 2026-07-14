package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	servicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	auth_handler "github.com/TaskForceAI/auth-service/pkg/handlers/auth"
)

func settingsRouter(user *adapterauth.AuthenticatedUser) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})

	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	auth_handler.RegisterSettingsHandler(api)
	return r
}

func settingsPUT(body any) *http.Request {
	raw, ok := body.(string)
	if !ok {
		b, _ := json.Marshal(body)
		raw = string(b)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/settings", bytes.NewBufferString(raw))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func settingsUserRow() *pgxmock.Rows {
	return dbtest.UserRow(dbtest.User{ID: 1, Email: "user@example.com", FullName: new("User")})
}

func expectSettingsAudit(mock pgxmock.PgxPoolIface) {
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery(`INSERT INTO audit_logs`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), "UPDATE", "user_settings", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id", "ip_address", "user_agent", "details", "success", "error_message"}).
			AddRow(int32(1), ts, nil, nil, "UPDATE", "user_settings", nil, nil, nil, []byte("{}"), true, nil))
}

func withSettingsPool(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	original := auth_handler.GetPool
	auth_handler.GetPool = func(context.Context) (auth_handler.Pool, error) {
		return mock, nil
	}
	t.Cleanup(func() { auth_handler.GetPool = original })
}

func TestSettingsRoute_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withSettingsPool(t, mock)
	redis := infraredis.NewMockClient()
	require.NoError(t, redis.Set(context.Background(), "user_settings:1", []byte(`{"memory_enabled":false}`), time.Minute))
	servicehandler.SetRedisClient(redis)
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE users SET theme_preference`).WithArgs(int32(1), "dark").WillReturnRows(settingsUserRow())
	mock.ExpectQuery(`UPDATE users SET memory_enabled`).WithArgs(int32(1), true).WillReturnRows(settingsUserRow())
	expectSettingsAudit(mock)
	mock.ExpectCommit()

	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{
		ThemePreference: new("dark"),
		MemoryEnabled:   new(true),
	}))

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"success":true`)
	_, err := redis.Get(context.Background(), "user_settings:1")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSettingsRoute_AllToggleFields(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withSettingsPool(t, mock)

	mock.ExpectBegin()
	for _, q := range []string{
		`UPDATE users SET full_name`,
		`UPDATE users SET web_search_enabled`,
		`UPDATE users SET code_execution_enabled`,
		`UPDATE users SET notifications_enabled`,
		`UPDATE users SET quick_mode_enabled`,
		`UPDATE users SET trust_layer_enabled`,
	} {
		mock.ExpectQuery(q).WithArgs(int32(1), pgxmock.AnyArg()).WillReturnRows(settingsUserRow())
	}
	expectSettingsAudit(mock)
	mock.ExpectCommit()

	web := true
	code := false
	notify := true
	quick := false
	trust := true
	name := "Updated User"
	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{
		FullName:             &name,
		WebSearchEnabled:     &web,
		CodeExecutionEnabled: &code,
		NotificationsEnabled: &notify,
		QuickModeEnabled:     &quick,
		TrustLayerEnabled:    &trust,
	}))

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSettingsRoute_SparseSingleFieldPayloads(t *testing.T) {
	tests := []struct {
		name  string
		body  string
		query string
		value bool
	}{
		{
			name:  "memory",
			body:  `{"memory_enabled":false}`,
			query: `UPDATE users SET memory_enabled`,
			value: false,
		},
		{
			name:  "web search",
			body:  `{"web_search_enabled":false}`,
			query: `UPDATE users SET web_search_enabled`,
			value: false,
		},
		{
			name:  "code execution",
			body:  `{"code_execution_enabled":false}`,
			query: `UPDATE users SET code_execution_enabled`,
			value: false,
		},
		{
			name:  "notifications",
			body:  `{"notifications_enabled":false}`,
			query: `UPDATE users SET notifications_enabled`,
			value: false,
		},
		{
			name:  "quick mode",
			body:  `{"quick_mode_enabled":false}`,
			query: `UPDATE users SET quick_mode_enabled`,
			value: false,
		},
		{
			name:  "trust layer",
			body:  `{"trust_layer_enabled":false}`,
			query: `UPDATE users SET trust_layer_enabled`,
			value: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := dbtest.NewMockPool(t)
			withSettingsPool(t, mock)

			mock.ExpectBegin()
			mock.ExpectQuery(tt.query).WithArgs(int32(1), tt.value).WillReturnRows(settingsUserRow())
			expectSettingsAudit(mock)
			mock.ExpectCommit()

			router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, settingsPUT(tt.body))

			assert.Equal(t, http.StatusOK, rr.Code)
			assert.Contains(t, rr.Body.String(), `"success":true`)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestSettingsRoute_ValidationErrorsDoNotCommit(t *testing.T) {
	tests := []struct {
		name     string
		fullName string
		message  string
	}{
		{name: "empty", fullName: "   ", message: "Full name cannot be empty"},
		{name: "too long", fullName: strings.Repeat("a", 129), message: "Full name must be 128 characters or fewer"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := dbtest.NewMockPool(t)
			withSettingsPool(t, mock)

			mock.ExpectBegin()
			mock.ExpectRollback()

			router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{FullName: &tt.fullName}))

			assert.Equal(t, http.StatusBadRequest, rr.Code)
			assert.Contains(t, rr.Body.String(), tt.message)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestSettingsRoute_Unauthorized(t *testing.T) {
	router := settingsRouter(nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{}))
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestSettingsRoute_UserIDTooLarge(t *testing.T) {
	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: math.MaxInt32 + 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{}))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestSettingsRoute_InvalidJSON(t *testing.T) {
	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT("{bad"))
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSettingsRoute_PoolUnavailable(t *testing.T) {
	original := auth_handler.GetPool
	auth_handler.GetPool = func(context.Context) (auth_handler.Pool, error) {
		return nil, errors.New("pool down")
	}
	t.Cleanup(func() { auth_handler.GetPool = original })

	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{}))
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestSettingsRoute_BeginError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withSettingsPool(t, mock)

	mock.ExpectBegin().WillReturnError(errors.New("begin failed"))

	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{}))

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSettingsRoute_UpdateError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withSettingsPool(t, mock)

	mock.ExpectBegin()
	mock.ExpectQuery(`UPDATE users SET theme_preference`).WithArgs(int32(1), "dark").WillReturnError(errors.New("update failed"))
	mock.ExpectRollback()

	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{ThemePreference: new("dark")}))

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSettingsRoute_CommitError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withSettingsPool(t, mock)

	mock.ExpectBegin()
	mock.ExpectCommit().WillReturnError(errors.New("commit failed"))
	mock.ExpectRollback()

	router := settingsRouter(&adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, settingsPUT(auth_handler.UpdateSettingsRequest{}))

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}
