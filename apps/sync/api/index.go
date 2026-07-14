// Package handler provides the consolidated API router for all sync endpoints.
package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/TaskForceAI/adapters/pkg/dbauth"
	appdatabase "github.com/TaskForceAI/go-sync/pkg/database"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	// Services & Repos
	syncpkg "github.com/TaskForceAI/go-sync/pkg/sync"
	"github.com/TaskForceAI/go-sync/pkg/synctelemetry"

	// Sync handlers
	remotehandlers "github.com/TaskForceAI/go-sync/pkg/handlers/remote"
	synchandlers "github.com/TaskForceAI/go-sync/pkg/handlers/sync"
	"github.com/TaskForceAI/go-sync/pkg/handlers/sync/realtime"
	synctoken "github.com/TaskForceAI/go-sync/pkg/handlers/sync/realtime/token"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"

	// Shared handler utilities
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/lazy"
	"github.com/TaskForceAI/adapters/pkg/observability"
)

var (
	getQueries                = appdatabase.GetQueries
	getHealthReport           = syncpkg.GetHealthReport
	newRedisStreamBroadcaster = syncpkg.NewRedisStreamBroadcaster
	newRedisLocker            = syncpkg.NewRedisLocker
	newRedisIdempotencyStore  = syncpkg.NewRedisIdempotencyStore
)

var (
	handlerMux http.Handler
	muxOnce    sync.Once
)

// Handler is the entrypoint for Vercel.
func Handler(w http.ResponseWriter, r *http.Request) {
	handlerutil.ServeVercelEntrypoint(w, r, &handlerMux, &muxOnce, handlerutil.VercelEntrypointOptions{
		ServiceName: "sync-server",
		BeforeInit: func(w http.ResponseWriter, r *http.Request) bool {
			// SSE needs to bypass recovery/CSRF wrapper composition.
			if r.URL.Path == "/api/v1/sync/realtime" {
				realtime.Handler(w, r)
				return true
			}
			return false
		},
		InitHandler: func() http.Handler {
			handlerutil.InitObservabilityAsync("sync-server")
			mux, _ := NewRouter()
			return handlerutil.SecureObservedHandler(mux, "SyncHandler", true)
		},
	})
}

// NewRouter creates a configured chi mux for the sync service.
func NewRouter() (*chi.Mux, huma.API) {
	r := chi.NewRouter()
	r.Use(handlerutil.ServiceHeader("sync-service"))
	r.Use(handlerutil.CORSMiddleware)
	r.Use(observability.WithHTTPMetrics("sync-server"))

	r.Use(func(next http.Handler) http.Handler {
		return dbauth.WithLazyOptionalDBAuth(getQueries, next.ServeHTTP)
	})

	r.Get("/api/v1/sync/realtime", realtime.Handler)
	r.Get(
		"/api/v1/remote/devices/{targetDeviceId}/ws",
		remotehandlers.WebSocketHandler(getQueries, redis.GetClient),
	)

	config := huma.DefaultConfig("TaskForceAI Sync", "1.0.0")
	api := humachi.New(r, config)

	depsResolver := newSyncDependenciesResolver()
	synchandlers.RegisterHandlersWithResolver(api, depsResolver)
	synctoken.RegisterHandlersWithResolver(api, getQueries)
	remotehandlers.RegisterHandlers(api, getQueries, redis.GetClient)

	// Operational Health Endpoint
	huma.Register(api, huma.Operation{
		OperationID: "sync-health",
		Method:      http.MethodGet,
		Path:        "/api/v1/sync/health",
		Summary:     "Deep health check",
		Tags:        []string{"Operations"},
	}, func(ctx context.Context, input *struct {
		handlerutil.OptionalAuthContext
		Deep bool `query:"deep"`
	}) (*struct{ Body any }, error) {
		report, err := getSyncHealthReport(ctx, input.Deep, input.User != nil)
		if err != nil {
			if errors.Is(err, errDeepHealthRequiresAuth) {
				return nil, huma.Error401Unauthorized("Authentication required for deep health checks")
			}
			return nil, huma.Error500InternalServerError("Health check failed")
		}
		return &struct{ Body any }{Body: report}, nil
	})

	// Silence common noise requests (browsers, bots, crawlers)
	handlerutil.RegisterCommonRoutes(r)

	// Catch-all for debugging 404s
	handlerutil.RegisterNotFound(r, "Sync service", "Route not found")

	return r, api
}

func newSyncDependenciesResolver() synchandlers.DependencyResolver {
	resolve := lazy.Cached(func(context.Context) (synchandlers.Dependencies, error) {
		q, err := getQueries(context.Background())
		if err != nil {
			return synchandlers.Dependencies{}, err
		}

		syncRepo := syncpkg.NewRepository(q)

		var broadcaster syncpkg.Broadcaster
		redisBroadcaster, bErr := newRedisStreamBroadcaster()
		if bErr != nil {
			slog.Warn("Real-time sync disabled: failed to init Redis Stream broadcaster", "error", bErr)
		} else {
			broadcaster = redisBroadcaster
		}

		resolver := syncpkg.NewAutoMergeResolver()

		locker, lockerErr := newRedisLocker()
		if lockerErr != nil {
			slog.Error("Sync locker unavailable: refusing to initialize sync dependencies", "error", lockerErr)
			return synchandlers.Dependencies{}, fmt.Errorf("init sync locker: %w", lockerErr)
		}

		idempotency, idemErr := newRedisIdempotencyStore()
		if idemErr != nil {
			slog.Error("Sync idempotency unavailable: refusing to initialize sync dependencies", "error", idemErr)
			return synchandlers.Dependencies{}, fmt.Errorf("init sync idempotency store: %w", idemErr)
		}
		if idempotency == nil {
			err := errors.New("sync idempotency store is nil")
			slog.Error("Sync idempotency unavailable: refusing to initialize sync dependencies", "error", err)
			return synchandlers.Dependencies{}, err
		}

		telemetry := synctelemetry.New()
		syncService := syncpkg.NewService(syncRepo, broadcaster, resolver, locker, idempotency, telemetry)

		return synchandlers.Dependencies{
			Service: syncService,
			Repo:    syncRepo,
			Queries: q,
		}, nil
	})
	return func(ctx context.Context) (synchandlers.Dependencies, error) {
		return resolve(ctx)
	}
}

var errDeepHealthRequiresAuth = errors.New("deep health requires authentication")

type publicSyncHealthReport struct {
	Status string `json:"status"`
}

func getSyncHealthReport(ctx context.Context, deep bool, authenticated bool) (any, error) {
	if deep {
		if !authenticated {
			return nil, errDeepHealthRequiresAuth
		}
		return getHealthReport(ctx)
	}
	return publicSyncHealthReport{Status: syncpkg.GetShallowHealthReport().Status}, nil
}
