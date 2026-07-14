package devicetoken

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/handlers/auth/device/internal/requestmeta"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
)

type TokenRequest struct {
	DeviceCode string `json:"device_code" validate:"required"`
}

type TokenResponse struct {
	Kind              string  `json:"kind"`
	Status            string  `json:"status"`
	AccessToken       string  `json:"access_token,omitempty"`
	AccessTokenCompat string  `json:"accessToken,omitempty"`
	TokenType         string  `json:"token_type,omitempty"`
	ExpiresIn         int     `json:"expires_in,omitempty"`
	ExpiresInCompat   int     `json:"expiresIn,omitempty"`
	Interval          int     `json:"interval,omitempty"`
	Message           string  `json:"message,omitempty"`
	Email             *string `json:"email,omitempty"`
}

type requestInfo struct {
	RemoteAddr   string
	ForwardedFor string
	ClientIP     *string
}

func (r *requestInfo) Resolve(ctx huma.Context) []error {
	r.RemoteAddr = ctx.RemoteAddr()
	r.ForwardedFor = ctx.Header("X-Forwarded-For")
	r.ClientIP = clientIPFromRequestInfo(*r)
	return nil
}

type Deps struct {
	Service     auth.DeviceService
	AuditLogger *auth.AuditService
	Limiter     *ratelimit.RedisRateLimiter
}

var registeredExchangeDeviceToken = exchangeDeviceToken

func RegisterHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "exchange-device-token",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/device/token",
		Summary:     "Exchange device code for token",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		requestInfo
		Body TokenRequest
	}) (*struct {
		Status int
		Body   TokenResponse
	}, error) {
		q, err := handler.ResolveQueries(ctx, nil)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		return registeredExchangeDeviceToken(ctx, input.requestInfo, input.Body, defaultDeps(q))
	})
}

func defaultDeps(q *db.Queries) Deps {
	var limiter *ratelimit.RedisRateLimiter
	if redisClient := handler.GetRedisClient(); redisClient != nil {
		limiter = ratelimit.NewRedisRateLimiter(redisClient, "")
	}

	return Deps{
		Service:     auth.NewDeviceLoginService(auth.NewDeviceLoginRepository(q)),
		AuditLogger: auth.NewAuditService(auth.NewAuditLogRepository(q)),
		Limiter:     limiter,
	}
}

func exchangeDeviceToken(ctx context.Context, req requestInfo, input TokenRequest, deps Deps) (*struct {
	Status int
	Body   TokenResponse
}, error) {
	if err := checkRateLimit(ctx, req.ClientIP, deps.Limiter); err != nil {
		return nil, err
	}
	if deps.Service == nil {
		handler.GetLogger().Error("Device Service not initialized in handler", nil)
		return nil, huma.Error500InternalServerError("internal_error")
	}

	outcome, err := deps.Service.ExchangeDeviceToken(ctx, input.DeviceCode, os.Getenv("AUTH_SECRET"))
	if err != nil {
		handler.GetLogger().Error("Token exchange failed", map[string]any{"error": err})
		return nil, huma.Error500InternalServerError("internal_error")
	}
	if outcome == nil {
		handler.GetLogger().Error("Token exchange returned empty outcome", nil)
		return nil, huma.Error500InternalServerError("internal_error")
	}

	if outcome.Kind == "APPROVED" && deps.AuditLogger != nil {
		deps.AuditLogger.LogEvent(ctx, auth.AuditLogWrite{
			Action:    "LOGIN",
			Resource:  "device",
			IPAddress: req.ClientIP,
			Success:   true,
		})
	}

	return &struct {
		Status int
		Body   TokenResponse
	}{
		Status: deviceTokenHTTPStatus(outcome.Kind),
		Body:   buildDeviceTokenResponse(outcome),
	}, nil
}

func buildDeviceTokenResponse(outcome *auth.DeviceLoginTokenOutcome) TokenResponse {
	response := TokenResponse{
		Kind:   outcome.Kind,
		Status: mapDeviceTokenStatus(outcome.Kind),
	}

	if outcome.AccessToken != "" {
		response.AccessToken = outcome.AccessToken
		response.AccessTokenCompat = outcome.AccessToken
		response.TokenType = "bearer"
	}
	if outcome.ExpiresIn > 0 {
		response.ExpiresIn = outcome.ExpiresIn
		response.ExpiresInCompat = outcome.ExpiresIn
	}
	if outcome.Interval > 0 {
		response.Interval = outcome.Interval
	}
	switch outcome.Kind {
	case "PENDING":
		response.Message = "authorization_pending"
	case "SLOW_DOWN":
		response.Message = "slow_down"
	}
	if outcome.Email != nil && strings.TrimSpace(*outcome.Email) != "" {
		response.Email = outcome.Email
	}

	return response
}

func deviceTokenHTTPStatus(kind string) int {
	switch kind {
	case "INVALID_CODE":
		return http.StatusNotFound
	case "EXPIRED":
		return http.StatusGone
	case "ALREADY_CLAIMED":
		return http.StatusConflict
	case "PENDING":
		return http.StatusAccepted
	case "SLOW_DOWN":
		return http.StatusTooManyRequests
	case "INVALID_USER", "UNKNOWN":
		return http.StatusInternalServerError
	default:
		return http.StatusOK
	}
}

func mapDeviceTokenStatus(kind string) string {
	switch kind {
	case "APPROVED":
		return "approved"
	case "PENDING":
		return "pending"
	case "SLOW_DOWN":
		return "slow_down"
	case "INVALID_CODE":
		return "invalid_code"
	case "EXPIRED":
		return "expired"
	case "ALREADY_CLAIMED":
		return "already_claimed"
	case "INVALID_USER":
		return "invalid_user"
	default:
		return "error"
	}
}

func checkRateLimit(ctx context.Context, ip *string, limiter *ratelimit.RedisRateLimiter) error {
	return requestmeta.CheckRateLimit(ctx, ip, limiter, requestmeta.RateLimitPolicy{
		KeyPrefix:                    "device_token",
		MaxRequests:                  ratelimit.DeviceTokenMaxRequests,
		Endpoint:                     "device token",
		ProductionMode:               requestmeta.ProductionOnAnyVercel,
		ContinueOnErrorInDevelopment: true,
	})
}

func clientIPFromRequestInfo(r requestInfo) *string {
	return requestmeta.ClientIP(r.ForwardedFor, r.RemoteAddr)
}
