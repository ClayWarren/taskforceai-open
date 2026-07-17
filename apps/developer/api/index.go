package handler

import (
	"context"
	"fmt"
	"github.com/TaskForceAI/adapters/pkg/dbauth"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	devhandler "github.com/TaskForceAI/developer-service/pkg/handler"
	developer "github.com/TaskForceAI/developer-service/pkg/handlers/developer"
	ratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

var (
	handlerMux http.Handler
	muxOnce    sync.Once

	developerBurstLimit = devhandler.WithOrgRateLimit(100, time.Minute)
	developerReadLimit  = devhandler.WithUserRateLimitScope("developer_read", 120, time.Hour)
	developerWriteLimit = devhandler.WithUserRateLimitScope("developer_write", 20, 24*time.Hour)

	rateLimitRedisClient redis.Cmdable
	rateLimitRedisOnce   sync.Once
)

type ServiceDeps struct {
	InitTracer func(serviceName string) (func(), error)
	InitMeter  func(serviceName string) (func(), error)
}

var serviceDeps = &ServiceDeps{}

func init() {
	initRateLimitDeps()
}

func initRateLimitDeps() {
	deps := &devhandler.RateLimitDeps{
		GetRedis:    func() any { return getRateLimitRedisClient() },
		GetOrgID:    adapterhandler.GetOrgID,
		GetUserID:   adapterhandler.GetUserID,
		GetClientIP: adapterhandler.GetClientIP,
		GetLogger:   func() devhandler.Logger { return slogAdapter{} },
		JSONError:   adapterhandler.JSONError,
		NewLimiter:  newRateLimiterAdapter,
	}
	devhandler.SetRateLimitDeps(deps)
}

func getRateLimitRedisClient() redis.Cmdable {
	rateLimitRedisOnce.Do(func() {
		if client := adapterhandler.GetRedisClient(); client != nil {
			if cmdable, ok := client.(redis.Cmdable); ok {
				rateLimitRedisClient = cmdable
				return
			}
		}

		rateLimitRedisClient = redis.NewClientFromEnv()
		if rateLimitRedisClient == nil {
			slog.Warn("Failed to initialize Redis client for rate limiting", "source", "developer-service env")
		}
	})
	return rateLimitRedisClient
}

type slogAdapter struct{}

func (s slogAdapter) Error(msg string, args ...any) {
	slog.Error(msg, args...)
}

func (s slogAdapter) Warn(msg string, args ...any) {
	slog.Warn(msg, args...)
}

func newRateLimiterAdapter(redisClient any, prefix string) devhandler.RateLimitChecker {
	if redisClient == nil {
		return nil
	}
	cmdable, ok := redisClient.(redis.Cmdable)
	if !ok {
		return nil
	}
	return &rateLimiterAdapter{limiter: ratelimit.NewRedisLimiter(cmdable, prefix)}
}

type rateLimiterAdapter struct {
	limiter ratelimit.Limiter
}

func adaptRateLimitResult(result *ratelimit.RateLimitResult, err error) (*devhandler.RateLimitResult, error) {
	if err != nil {
		return nil, err
	}
	return &devhandler.RateLimitResult{Allowed: result.Allowed, Remaining: result.Remaining, ResetTime: result.ResetTime}, nil
}

func (a *rateLimiterAdapter) Check(ctx any, key string, limit int, window time.Duration) (*devhandler.RateLimitResult, error) {
	c, ok := ctx.(context.Context)
	if !ok {
		return nil, fmt.Errorf("rate limiter context must be context.Context, got %T", ctx)
	}
	return adaptRateLimitResult(a.limiter.Check(c, key, limit, window))
}

func (a *rateLimiterAdapter) CheckOrg(ctx any, orgID int32, limit int, window time.Duration) (*devhandler.RateLimitResult, error) {
	c, ok := ctx.(context.Context)
	if !ok {
		return nil, fmt.Errorf("rate limiter context must be context.Context, got %T", ctx)
	}
	return adaptRateLimitResult(a.limiter.CheckOrg(c, orgID, limit, window))
}

func Handler(w http.ResponseWriter, r *http.Request) {
	adapterhandler.ServeVercelEntrypoint(w, r, &handlerMux, &muxOnce, adapterhandler.VercelEntrypointOptions{
		ServiceName:    "developer-service",
		InitLogMessage: "Initializing global router for Developer service",
		BeforeInit: func(w http.ResponseWriter, r *http.Request) bool {
			if r.URL.Path == "/api/v1/developer/health" && !adapterhandler.IsDeepHealthCheck(r) {
				developerBurstLimit(adapterhandler.WithSecurityHeaders(handleHealthCheck)).ServeHTTP(w, r)
				return true
			}
			return false
		},
		InitHandler: func() http.Handler {
			initTracer := observability.InitTracer
			initMeter := observability.InitMeter
			if serviceDeps.InitTracer != nil {
				initTracer = serviceDeps.InitTracer
			}
			if serviceDeps.InitMeter != nil {
				initMeter = serviceDeps.InitMeter
			}

			adapterhandler.InitObservabilityWith("developer-service", initTracer, initMeter)
			mux, _ := NewRouter()
			return adapterhandler.SecureObservedHandler(mux, "DeveloperHandler", false)
		},
	})
}

func NewRouter() (*chi.Mux, huma.API) {
	r := chi.NewRouter()
	r.Use(adapterhandler.CORSMiddleware)
	r.Use(adapterhandler.ServiceHeader("developer-service"))
	r.Use(observability.WithHTTPMetrics("developer-service"))

	r.Use(func(next http.Handler) http.Handler {
		return dbauth.WithLazyOptionalDBAuth(devhandler.GetQueries, next.ServeHTTP)
	})
	r.Use(adapterhandler.CSRFMiddleware)
	r.Use(withDeveloperDashboardRateLimits(developerReadLimit, developerWriteLimit))

	config := huma.DefaultConfig("TaskForceAI Developer API", "1.0.0")
	api := humachi.New(r, config)

	developer.RegisterUsageHandler(api, nil)
	developer.RegisterKeysHandlers(api, nil)

	r.Handle("/api/v1/developer/health", developerBurstLimit(http.HandlerFunc(handleHealthCheck)))
	r.Handle("/api/v1/developer/debug", developerBurstLimit(http.HandlerFunc(adapterhandler.HandleDebug)))

	adapterhandler.RegisterCommonRoutes(r)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if shouldProxyEnginePath(path) {
			authReq, ok := ensureProxyEngineAuth(w, r)
			if !ok {
				return
			}
			adapterhandler.ProxyEngineHandler.ServeHTTP(w, authReq)
			return
		}

		adapterhandler.GetLogger().WarnContext(
			r.Context(),
			"Route not found in Developer service",
			"path", r.URL.Path,
			"method", r.Method,
			"__path", r.URL.Query().Get("__path"),
			"matched_path", r.Header.Get("X-Matched-Path"),
		)
		adapterhandler.JSONError(w, http.StatusNotFound, "Developer route not found: "+r.URL.Path)
	})

	return r, api
}

func withDeveloperDashboardRateLimits(
	readLimit func(http.Handler) http.Handler,
	writeLimit func(http.Handler) http.Handler,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		readHandler := readLimit(next)
		writeHandler := writeLimit(next)

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet &&
				(r.URL.Path == "/api/v1/developer/keys" || r.URL.Path == "/api/v1/developer/usage"):
				readHandler.ServeHTTP(w, r)
			case (r.Method == http.MethodPost || r.Method == http.MethodDelete) &&
				r.URL.Path == "/api/v1/developer/keys":
				writeHandler.ServeHTTP(w, r)
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}

func ensureProxyEngineAuth(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	if adapterhandler.GetAuthenticatedUser(r) != nil {
		return r, true
	}

	if strings.TrimSpace(r.Header.Get("x-api-key")) == "" {
		adapterhandler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return nil, false
	}

	dbQueries, err := devhandler.GetQueries(r.Context())
	if err != nil {
		adapterhandler.JSONError(w, http.StatusServiceUnavailable, "Database unavailable")
		return nil, false
	}

	allowed := false
	var authedRequest *http.Request
	devhandler.WithAPIKeyIdentity(dbQueries, func(_ http.ResponseWriter, req *http.Request) {
		allowed = true
		authedRequest = req
	})(w, r)
	if !allowed {
		return nil, false
	}
	return authedRequest, true
}

func handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	if !adapterhandler.RequireAuthenticatedDeepHealth(w, r) {
		return
	}
	adapterhandler.WriteDatabaseHealth(w, r, "1.0.0", devhandler.GetPool)
}

func shouldProxyEnginePath(path string) bool {
	return hasPathPrefixBoundary(path, "/api/v1/developer/run") ||
		hasPathPrefixBoundary(path, "/api/v1/developer/status") ||
		hasPathPrefixBoundary(path, "/api/v1/developer/results") ||
		hasPathPrefixBoundary(path, "/api/v1/developer/threads") ||
		hasPathPrefixBoundary(path, "/api/v1/developer/storage") ||
		hasPathPrefixBoundary(path, "/api/v1/developer/files")
}

func hasPathPrefixBoundary(path, prefix string) bool {
	return path == prefix || strings.HasPrefix(path, prefix+"/")
}
