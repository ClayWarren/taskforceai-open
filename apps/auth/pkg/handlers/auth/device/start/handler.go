package start

import (
	"context"
	"errors"
	"log/slog"
	"net"
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

type Deps struct {
	Service auth.DeviceService
	Limiter *ratelimit.RedisRateLimiter
}

type requestInfo struct {
	Host             string
	RemoteAddr       string
	ForwardedFor     string
	ForwardedHost    string
	ForwardedProto   string
	HasTLS           bool
	ResolvedClientIP *string
}

var registeredStartDeviceLogin = startDeviceLogin

func (r *requestInfo) Resolve(ctx huma.Context) []error {
	r.Host = ctx.Host()
	r.RemoteAddr = ctx.RemoteAddr()
	r.ForwardedFor = ctx.Header("X-Forwarded-For")
	r.ForwardedHost = ctx.Header("X-Forwarded-Host")
	r.ForwardedProto = ctx.Header("X-Forwarded-Proto")
	r.HasTLS = ctx.TLS() != nil
	r.ResolvedClientIP = clientIPFromRequestInfo(*r)
	return nil
}

func RegisterHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "start-device-login",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/device/start",
		Summary:     "Start device login",
		Tags:        []string{"Auth"},
	}, func(ctx context.Context, input *struct {
		requestInfo
	}) (*struct {
		Status int `status:"201"`
		Body   *auth.DeviceLoginStartPayload
	}, error) {
		q, err := handler.ResolveQueries(ctx, nil)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		return registeredStartDeviceLogin(ctx, input.requestInfo, defaultDeps(q))
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

func startDeviceLogin(ctx context.Context, req requestInfo, deps Deps) (*struct {
	Status int `status:"201"`
	Body   *auth.DeviceLoginStartPayload
}, error) {
	if err := checkRateLimit(ctx, req.ResolvedClientIP, deps.Limiter); err != nil {
		return nil, err
	}
	if deps.Service == nil {
		handler.GetLogger().Error("Device Service not initialized in handler", nil)
		return nil, huma.Error500InternalServerError("internal_error")
	}

	result, err := deps.Service.StartDeviceLogin(ctx, resolveBaseURLFromInfo(req))
	if err != nil {
		if errors.Is(err, auth.ErrUnavailable) {
			return nil, huma.Error503ServiceUnavailable("login_unavailable")
		}
		slog.Error("Device login start failed", "error", err)
		return nil, huma.Error500InternalServerError("internal_error")
	}

	return &struct {
		Status int `status:"201"`
		Body   *auth.DeviceLoginStartPayload
	}{Status: http.StatusCreated, Body: result}, nil
}

func resolveBaseURLFromInfo(r requestInfo) string {
	if appURL := strings.TrimSpace(os.Getenv("APP_URL")); appURL != "" {
		return strings.TrimSuffix(appURL, "/")
	}

	if webURL := strings.TrimSpace(os.Getenv("WEB_URL")); webURL != "" {
		return strings.TrimSuffix(webURL, "/")
	}

	if authURL := strings.TrimSpace(os.Getenv("AUTH_URL")); authURL != "" {
		return strings.TrimSuffix(authURL, "/")
	}

	host := ""
	if forwardedHost := normalizeHostForURL(r.ForwardedHost); forwardedHost != "" && isTrustedPublicHost(forwardedHost) {
		host = forwardedHost
	}
	if host == "" {
		requestHost := normalizeHostForURL(r.Host)
		if requestHost != "" && isTrustedPublicHost(requestHost) {
			host = requestHost
		}
	}
	if host == "" {
		return "http://localhost:3000"
	}

	protocol := normalizeForwardedProto(r.ForwardedProto)
	if protocol == "" {
		switch {
		case r.HasTLS:
			protocol = "https"
		case isLocalHost(host):
			protocol = "http"
		default:
			protocol = "https"
		}
	}

	return strings.TrimSuffix(protocol+"://"+host, "/")
}

func normalizeHeaderValue(raw string) string {
	value := strings.TrimSpace(raw)
	if idx := strings.Index(value, ","); idx >= 0 {
		value = strings.TrimSpace(value[:idx])
	}
	return value
}

func normalizeHostForURL(raw string) string {
	host := normalizeHeaderValue(raw)
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimRight(host, "/")
	return strings.ToLower(strings.TrimSpace(host))
}

func hostName(rawHost string) string {
	host := normalizeHostForURL(rawHost)
	if host == "" {
		return ""
	}
	if onlyHost, _, err := net.SplitHostPort(host); err == nil {
		host = onlyHost
	}
	host = strings.Trim(host, "[]")
	return strings.ToLower(strings.TrimSpace(host))
}

func isLocalHost(rawHost string) bool {
	normalized := hostName(rawHost)
	if normalized == "" {
		return false
	}
	if normalized == "localhost" || strings.HasSuffix(normalized, ".localhost") {
		return true
	}
	if ip := net.ParseIP(normalized); ip != nil && ip.IsLoopback() {
		return true
	}
	return false
}

func isTrustedPublicHost(rawHost string) bool {
	normalized := hostName(rawHost)
	if normalized == "" {
		return false
	}
	if isLocalHost(normalized) {
		return true
	}
	if normalized == "taskforceai.chat" || strings.HasSuffix(normalized, ".taskforceai.chat") {
		return true
	}

	allowed := hostName(strings.TrimSpace(os.Getenv("ALLOWED_REDIRECT_DOMAIN")))
	return allowed != "" && (normalized == allowed || strings.HasSuffix(normalized, "."+allowed))
}

func normalizeForwardedProto(raw string) string {
	proto := strings.ToLower(normalizeHeaderValue(raw))
	if proto == "http" || proto == "https" {
		return proto
	}
	return ""
}

func clientIPFromRequestInfo(r requestInfo) *string {
	return requestmeta.ClientIP(r.ForwardedFor, r.RemoteAddr)
}

func checkRateLimit(ctx context.Context, ip *string, limiter *ratelimit.RedisRateLimiter) error {
	return requestmeta.CheckRateLimit(ctx, ip, limiter, requestmeta.RateLimitPolicy{
		KeyPrefix:                    "device_start",
		MaxRequests:                  ratelimit.DeviceStartMaxRequests,
		Endpoint:                     "device endpoint",
		ProductionMode:               requestmeta.ProductionOnAnyVercel,
		ContinueOnErrorInDevelopment: true,
	})
}
