package authorize

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/handlers/auth/device/internal/requestmeta"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
)

type AuthorizeRequest struct {
	UserCode string `json:"user_code" validate:"required"`
}

type AuthorizeResponse struct {
	Status string `json:"status"`
}

type Deps struct {
	Service auth.DeviceService
	Limiter *ratelimit.RedisRateLimiter
}

type requestInfo struct {
	User             *adapterauth.AuthenticatedUser
	ClientIP         *string
	UserAgent        string
	Authorization    string
	APIKey           string
	CSRFToken        string
	CSRFTokenCookie  string
	HasSessionCookie bool
}

func (r *requestInfo) Resolve(ctx huma.Context) []error {
	r.ClientIP = clientIPFromRequestInfo(ctx.Header("X-Forwarded-For"), ctx.RemoteAddr())
	r.UserAgent = ctx.Header("User-Agent")
	r.Authorization = ctx.Header("Authorization")
	r.APIKey = ctx.Header("x-api-key")
	r.CSRFToken = ctx.Header("X-CSRF-Token")
	r.CSRFTokenCookie = cookieValue(ctx.Header("Cookie"), "csrf_token")
	r.HasSessionCookie = cookieValue(ctx.Header("Cookie"), "__Secure-session_token") != "" ||
		cookieValue(ctx.Header("Cookie"), "session_token") != ""
	user, ok := ctx.Context().Value(adapterhandler.UserContextKey).(*adapterauth.AuthenticatedUser)
	if !ok || user == nil {
		return []error{huma.Error401Unauthorized("Unauthorized")}
	}
	r.User = user

	if err := validateCSRF(*r); err != nil {
		return []error{err}
	}
	return nil
}

func RegisterHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "authorize-device-login",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/device/authorize",
		Summary:     "Authorize device login",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		requestInfo
		Body AuthorizeRequest
	}) (*struct{ Body AuthorizeResponse }, error) {
		q, err := handler.ResolveQueries(ctx, nil)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		return authorizeDeviceLogin(ctx, input.User.ID, input.requestInfo, input.Body, defaultDeps(q))
	})
}

func defaultDeps(q *db.Queries) Deps {
	var limiter *ratelimit.RedisRateLimiter
	if redisClient := handler.GetRedisClient(); redisClient != nil {
		limiter = ratelimit.NewRedisRateLimiter(redisClient, "")
	}

	return Deps{
		Service: auth.NewDeviceLoginService(auth.NewDeviceLoginRepository(q)),
		Limiter: limiter,
	}
}

func authorizeDeviceLogin(ctx context.Context, userID int, req requestInfo, input AuthorizeRequest, deps Deps) (*struct{ Body AuthorizeResponse }, error) {
	if err := checkRateLimit(ctx, req.ClientIP, deps.Limiter); err != nil {
		return nil, err
	}
	if deps.Service == nil {
		handler.GetLogger().Error("Device Service not initialized in handler", nil)
		return nil, huma.Error500InternalServerError("internal_error")
	}

	err := deps.Service.AuthorizeDeviceLogin(ctx, userID, input.UserCode)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidCode):
			return nil, huma.Error404NotFound("invalid_code")
		case errors.Is(err, auth.ErrExpired):
			return nil, huma.Error410Gone("expired")
		case errors.Is(err, auth.ErrAlreadyUsed):
			return nil, huma.Error409Conflict("already_used")
		default:
			handler.GetLogger().Error("Device login authorize failed", map[string]any{"error": err})
			return nil, huma.Error500InternalServerError("internal_error")
		}
	}

	return &struct{ Body AuthorizeResponse }{Body: AuthorizeResponse{Status: "authorized"}}, nil
}

func validateCSRF(req requestInfo) error {
	authHeader := strings.TrimSpace(req.Authorization)
	hasBearerToken := strings.HasPrefix(strings.ToLower(authHeader), "bearer ") &&
		len(strings.TrimSpace(authHeader[len("Bearer "):])) > 0
	hasAPIKey := strings.TrimSpace(req.APIKey) != ""
	hasHeaderOnlyAuth := (hasBearerToken || hasAPIKey) && !req.HasSessionCookie
	isNonBrowser := strings.Contains(req.UserAgent, "taskforceai-cli") ||
		strings.Contains(req.UserAgent, "TaskForceAI-Desktop") ||
		strings.Contains(req.UserAgent, "TaskForceAI-Mobile") ||
		hasHeaderOnlyAuth
	if isNonBrowser {
		return nil
	}

	if req.CSRFToken == "" {
		return huma.Error403Forbidden("CSRF token missing")
	}
	if req.CSRFTokenCookie == "" {
		return huma.Error403Forbidden("CSRF cookie missing")
	}
	if req.CSRFTokenCookie != req.CSRFToken {
		return huma.Error403Forbidden("CSRF token mismatch")
	}
	return nil
}

func checkRateLimit(ctx context.Context, ip *string, limiter *ratelimit.RedisRateLimiter) error {
	return requestmeta.CheckRateLimit(ctx, ip, limiter, requestmeta.RateLimitPolicy{
		KeyPrefix:      "device_auth",
		MaxRequests:    ratelimit.DeviceAuthMaxRequests,
		Endpoint:       "device auth",
		ProductionMode: requestmeta.ProductionOnVercelEnvProduction,
	})
}

func clientIPFromRequestInfo(forwardedFor, remoteAddr string) *string {
	return requestmeta.ClientIP(forwardedFor, remoteAddr)
}

func cookieValue(rawCookie, name string) string {
	for part := range strings.SplitSeq(rawCookie, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && key == name {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
