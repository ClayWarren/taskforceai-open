package requestmeta

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
)

type ProductionMode int

const (
	ProductionOnAnyVercel ProductionMode = iota
	ProductionOnVercelEnvProduction
)

type RateLimitPolicy struct {
	KeyPrefix                    string
	MaxRequests                  int
	Endpoint                     string
	ProductionMode               ProductionMode
	ContinueOnErrorInDevelopment bool
}

func ClientIP(forwardedFor, remoteAddr string) *string {
	req := &http.Request{
		Header:     http.Header{},
		RemoteAddr: strings.TrimSpace(remoteAddr),
	}
	if strings.TrimSpace(forwardedFor) != "" {
		req.Header.Set("X-Forwarded-For", forwardedFor)
	}
	if ip := handler.GetClientIP(req); ip != nil {
		return ip
	}
	return handler.ClientIPFromRemoteAddr(remoteAddr)
}

func CheckRateLimit(ctx context.Context, ip *string, limiter *ratelimit.RedisRateLimiter, policy RateLimitPolicy) error {
	if limiter == nil {
		if !IsProductionEnv(policy.ProductionMode) {
			return nil
		}
		handler.GetLogger().Error("Rate limiter unavailable for "+policy.Endpoint+" in production", nil)
		return huma.Error503ServiceUnavailable("service_unavailable")
	}
	if ip == nil {
		return nil
	}

	res, err := limiter.Check(ctx, policy.KeyPrefix+":"+*ip, policy.MaxRequests, time.Minute)
	if err != nil {
		handler.GetLogger().Warn("Rate limiter check failed for "+policy.Endpoint, map[string]any{"error": err.Error()})
		if policy.ContinueOnErrorInDevelopment && !IsProductionEnv(policy.ProductionMode) {
			return nil
		}
		return huma.Error503ServiceUnavailable("service_unavailable")
	}
	if res.Allowed {
		return nil
	}
	handler.GetLogger().Warn("Rate limit exceeded for "+policy.Endpoint, map[string]any{"ip": *ip})
	return huma.Error429TooManyRequests("Too many requests")
}

func IsProductionEnv(mode ProductionMode) bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "production") {
		return true
	}
	switch mode {
	case ProductionOnVercelEnvProduction:
		return strings.EqualFold(strings.TrimSpace(os.Getenv("VERCEL_ENV")), "production")
	default:
		return strings.TrimSpace(os.Getenv("VERCEL")) != ""
	}
}
