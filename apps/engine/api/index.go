// Package handler provides the consolidated API router for all engine interaction endpoints.
package handler

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	"github.com/TaskForceAI/go-engine/pkg/run"

	streamapi "github.com/TaskForceAI/go-engine/api/v1"

	// Engine handlers (local to go-engine)
	coreusage "github.com/TaskForceAI/core/pkg/usage"
	enginehandler "github.com/TaskForceAI/go-engine/pkg/handler"
	"github.com/TaskForceAI/go-engine/pkg/handlers/developer"
	developerfiles "github.com/TaskForceAI/go-engine/pkg/handlers/developer/files"
	"github.com/TaskForceAI/go-engine/pkg/handlers/integrations"
	runhandler "github.com/TaskForceAI/go-engine/pkg/handlers/run"
	voicehandler "github.com/TaskForceAI/go-engine/pkg/handlers/voice"

	// Shared handler utilities
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	"github.com/riandyrn/otelchi"
)

var (
	handlerMux http.Handler
	muxOnce    sync.Once
)

// Handler is the entrypoint for Vercel.
func Handler(w http.ResponseWriter, r *http.Request) {
	handlerutil.ServeVercelEntrypoint(w, r, &handlerMux, &muxOnce, handlerutil.VercelEntrypointOptions{
		ServiceName: "engine-server",
		BeforeInit:  enginehandler.HandlePreInitRoute,
		InitHandler: func() http.Handler {
			handlerutil.InitObservabilityAsync("engine-server")
			mux, _ := NewRouter(nil)
			return handlerutil.SecureObservedHandler(mux, "EngineHandler", true)
		},
	})
}

// NewRouter creates a configured chi mux for the engine.
func NewRouter(shutdownGroup *sync.WaitGroup) (*chi.Mux, huma.API) {
	r := chi.NewRouter()
	r.Use(enginehandler.WithServiceHeadersAndCORS)
	r.Use(otelchi.Middleware("engine-server"))
	r.Use(observability.WithHTTPMetrics("engine-server"))
	r.Use(enginehandler.InngestSignatureVerifier)
	r.Use(enginehandler.ReadinessMiddleware)
	r.Use(enginehandler.AuthMiddleware())

	if dbErr, redisErr := enginehandler.ProbeOperationalDependencies(context.Background()); dbErr != nil {
		handlerutil.GetLogger().Error("Failed to get DB queries for Engine handlers", map[string]any{
			"error": dbErr,
		})
		enginehandler.SetEngineReadiness(false, "database_unavailable")
	} else if redisErr != nil {
		handlerutil.GetLogger().Error("Failed to initialize Redis for Engine readiness", map[string]any{
			"error": redisErr,
		})
		enginehandler.SetEngineReadiness(false, "redis_unavailable")
	} else {
		enginehandler.SetEngineReadiness(true, "ok")
	}

	config := huma.DefaultConfig("TaskForceAI Engine", "1.0.0")
	config.Components.Schemas = huma.NewMapRegistry("#/components/schemas/", func(t reflect.Type, hint string) string {
		if t.Name() == "" {
			return huma.DefaultSchemaNamer(t, hint)
		}
		pkg := strings.ReplaceAll(t.PkgPath(), "/", "_")
		if pkg == "" {
			return t.Name()
		}
		return pkg + "_" + t.Name()
	})
	api := humachi.New(r, config)

	r.Get("/api/v1/stream/*", streamapi.Handler)
	r.Options("/api/v1/stream/*", streamapi.Handler)

	convService := conversationServiceLoader{}
	intService := integrationsServiceLoader{}
	runQueries := enginehandler.LazyRunQueries{}
	developerQueries := enginehandler.LazyDeveloperQueries{}
	filesQueries := enginehandler.LazyFilesQueries{}

	inngestClient := run.NewInngestClient()

	runhandler.RegisterHandlers(api, runQueries, inngestClient)
	voicehandler.RegisterHandlers(api, voiceLimiterProvider, voiceUsageWriter)
	runhandler.RegisterInngestHandler(api, shutdownGroup)
	r.Handle("/api/inngest/serve", runhandler.NewInngestServeHandler(shutdownGroup))
	// Team coordination is currently process-local. Do not expose it through the
	// serverless HTTP API until the store is durable and access is owner-bound.
	integrations.RegisterHandlers(api, intService)
	developer.RegisterHandlers(api, developerQueries, convService, inngestClient)
	developerfiles.RegisterHandlers(api, filesQueries)

	enginehandler.RegisterOperationalRoutes(api)

	// Silence common noise requests (browsers, bots, crawlers)
	for _, route := range handlerutil.CommonRoutes() {
		r.HandleFunc(route.Pattern, route.Handler)
	}

	// Catch-all for debugging 404s
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		handlerutil.GetLogger().WarnContext(
			r.Context(),
			"Route not found in Engine service",
			"path", r.URL.Path,
			"method", r.Method,
			"__path", r.URL.Query().Get("__path"),
			"matched_path", r.Header.Get("X-Matched-Path"),
		)
		handlerutil.JSONError(w, http.StatusNotFound, "Route not found")
	})

	return r, api
}

func voiceLimiterProvider() (ratelimit.Limiter, error) {
	client, err := enginehandler.RedisClientGetter()
	if err != nil {
		return nil, err
	}
	if client == nil {
		return nil, errors.New("redis client is nil")
	}
	return ratelimit.NewRedisLimiter(client, "rl:voice"), nil
}

func voiceUsageWriter(ctx context.Context, row coreusage.EventRow) error {
	q, err := enginehandler.GetQueries(ctx)
	if err != nil {
		return err
	}
	return q.CreateUsageEvents(ctx, []coreusage.EventRow{row})
}
