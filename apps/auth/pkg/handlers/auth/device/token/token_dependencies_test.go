package devicetoken

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestDefaultDepsUsesRedisClient(t *testing.T) {
	authhandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	deps := defaultDeps(&db.Queries{})

	assert.NotNil(t, deps.Service)
	assert.NotNil(t, deps.AuditLogger)
	assert.NotNil(t, deps.Limiter)
}

func TestRegisterHandlerUsesDefaultDeps(t *testing.T) {
	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	previous := registeredExchangeDeviceToken
	registeredExchangeDeviceToken = func(ctx context.Context, req requestInfo, input TokenRequest, deps Deps) (*struct {
		Status int
		Body   TokenResponse
	}, error) {
		assert.NotNil(t, deps.Service)
		assert.NotNil(t, deps.AuditLogger)
		assert.Equal(t, "device", input.DeviceCode)
		return &struct {
			Status int
			Body   TokenResponse
		}{
			Status: http.StatusAccepted,
			Body:   TokenResponse{Kind: "PENDING", Status: "pending"},
		}, nil
	}
	t.Cleanup(func() { registeredExchangeDeviceToken = previous })

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandler(api)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/token", strings.NewReader(`{"device_code":"device"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusAccepted, rr.Code)
}

func TestExchangeDeviceTokenAuditsApprovedOutcome(t *testing.T) {
	t.Setenv("AUTH_SECRET", "secret")
	ip := "1.2.3.4"
	mockService := new(auth_mocks.DeviceService)
	mockService.On("ExchangeDeviceToken", mock.Anything, "device", "secret").Return(&auth.DeviceLoginTokenOutcome{
		Kind:        "APPROVED",
		AccessToken: "token",
	}, nil)
	mockPool := dbtest.NewMockPool(t)
	mockPool.ExpectQuery(`INSERT INTO audit_logs`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), "LOGIN", "device", pgxmock.AnyArg(), &ip, pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id", "ip_address", "user_agent", "details", "success", "error_message",
		}).AddRow(int32(1), pgtype.Timestamp{Time: time.Now(), Valid: true}, nil, nil, "LOGIN", "device", nil, &ip, nil, nil, true, nil))

	result, err := exchangeDeviceToken(context.Background(), requestInfo{ClientIP: &ip}, TokenRequest{DeviceCode: "device"}, Deps{
		Service:     mockService,
		AuditLogger: auth.NewAuditService(auth.NewAuditLogRepository(db.New(mockPool))),
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "APPROVED", result.Body.Kind)
	mockService.AssertExpectations(t)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestCheckRateLimitAllowedAndNoIP(t *testing.T) {
	require.NoError(t, checkRateLimit(context.Background(), nil, nil))

	emptyRedis := new(ratelimit_mocks.RedisClient)
	require.NoError(t, checkRateLimit(context.Background(), nil, ratelimit.NewRedisRateLimiter(emptyRedis, "")))

	ip := "1.2.3.4"
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(1, nil)
	mockRedis.On("Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	limiter := ratelimit.NewRedisRateLimiter(mockRedis, "")

	err := checkRateLimit(context.Background(), &ip, limiter)

	require.NoError(t, err)
	mockRedis.AssertExpectations(t)
}
