// Package handler provides the consolidated API router for all non-SSE core endpoints.
package handler

import (
	"context"
	"github.com/TaskForceAI/adapters/pkg/dbauth"
	appdatabase "github.com/TaskForceAI/go-core/pkg/database"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	adapterartifacts "github.com/TaskForceAI/adapters/pkg/artifacts"
	auditpkg "github.com/TaskForceAI/adapters/pkg/audit"
	conversationadapters "github.com/TaskForceAI/adapters/pkg/conversations"
	"github.com/TaskForceAI/adapters/pkg/db"
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/lazy"
	memoryadapters "github.com/TaskForceAI/adapters/pkg/memories"
	sharednotifications "github.com/TaskForceAI/adapters/pkg/notifications"
	"github.com/TaskForceAI/adapters/pkg/observability"
	artifactspkg "github.com/TaskForceAI/core/pkg/artifacts"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"github.com/TaskForceAI/core/pkg/identity"
	memoriespkg "github.com/TaskForceAI/core/pkg/memories"
	notificationspkg "github.com/TaskForceAI/core/pkg/notifications"
	"github.com/TaskForceAI/core/pkg/platform"
	projectspkg "github.com/TaskForceAI/core/pkg/projects"
	adminpkg "github.com/TaskForceAI/go-core/pkg/admin"
	"github.com/TaskForceAI/go-core/pkg/coreconfigsource"
	corefinance "github.com/TaskForceAI/go-core/pkg/finance"
	health "github.com/TaskForceAI/go-core/pkg/handlers"
	"github.com/TaskForceAI/go-core/pkg/handlers/admin"
	"github.com/TaskForceAI/go-core/pkg/handlers/agents"
	artifactshandler "github.com/TaskForceAI/go-core/pkg/handlers/artifacts"
	"github.com/TaskForceAI/go-core/pkg/handlers/conversations"
	"github.com/TaskForceAI/go-core/pkg/handlers/cron"
	desktopupdate "github.com/TaskForceAI/go-core/pkg/handlers/desktop/update"
	download "github.com/TaskForceAI/go-core/pkg/handlers/download/get"
	financehandler "github.com/TaskForceAI/go-core/pkg/handlers/finance"
	"github.com/TaskForceAI/go-core/pkg/handlers/gdpr"
	"github.com/TaskForceAI/go-core/pkg/handlers/memories"
	"github.com/TaskForceAI/go-core/pkg/handlers/notifications"
	"github.com/TaskForceAI/go-core/pkg/handlers/org"
	projects "github.com/TaskForceAI/go-core/pkg/handlers/projects"
	publicshare "github.com/TaskForceAI/go-core/pkg/handlers/public-share"
	status "github.com/TaskForceAI/go-core/pkg/handlers/status"
	"github.com/TaskForceAI/go-core/pkg/handlers/support"
	"github.com/TaskForceAI/go-core/pkg/middleware"
	"github.com/TaskForceAI/go-core/pkg/pulsebridge"
	"github.com/TaskForceAI/infrastructure/email/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

var (
	handlerMux http.Handler
	muxOnce    sync.Once
)

const degradedRouterRefreshInterval = 30 * time.Second

type degradedRouterState struct {
	mu              sync.RWMutex
	currentMux      http.Handler
	degraded        bool
	refreshing      bool
	lastRefresh     time.Time
	refreshInterval time.Duration
	now             func() time.Time
	rebuild         func() (http.Handler, bool)
}

func newDegradedRouterState(currentMux http.Handler, degraded bool, refreshInterval time.Duration, rebuild func() (http.Handler, bool)) *degradedRouterState {
	return &degradedRouterState{
		currentMux:      currentMux,
		degraded:        degraded,
		refreshInterval: refreshInterval,
		now:             time.Now,
		rebuild:         rebuild,
	}
}

func (s *degradedRouterState) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.refreshIfNeeded()

	s.mu.RLock()
	activeMux := s.currentMux
	s.mu.RUnlock()

	activeMux.ServeHTTP(w, r)
}

func (s *degradedRouterState) refreshIfNeeded() {
	if !s.startRefresh() {
		return
	}

	refreshedMux, refreshedDegraded := s.rebuild()

	s.mu.Lock()
	s.currentMux = refreshedMux
	s.degraded = refreshedDegraded
	s.refreshing = false
	s.mu.Unlock()
}

func (s *degradedRouterState) startRefresh() bool {
	now := s.now()

	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.degraded || s.refreshing || now.Sub(s.lastRefresh) < s.refreshInterval {
		return false
	}

	s.refreshing = true
	s.lastRefresh = now
	return true
}

// Handler is the entrypoint for Vercel.
func Handler(w http.ResponseWriter, r *http.Request) {
	handlerutil.ServeVercelEntrypoint(w, r, &handlerMux, &muxOnce, handlerutil.VercelEntrypointOptions{
		ServiceName:    "core-api",
		InitLogMessage: "Initializing global router for Core service",
		ExtraDebugHeaders: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Debug-Matched-Path", r.Header.Get("X-Matched-Path"))
		},
		// Proxy routes to microservices before security middleware because
		// upstream services manage their own security/CSRF.
		BeforeInit: handlerutil.ProxyCoreServiceRoute,
		InitHandler: func() http.Handler {
			handlerutil.InitObservabilityAsync("core-api")
			mux, _, degraded := NewRouter()
			routerState := newDegradedRouterState(mux, degraded, degradedRouterRefreshInterval, func() (http.Handler, bool) {
				refreshedMux, _, refreshedDegraded := NewRouter()
				return refreshedMux, refreshedDegraded
			})
			return handlerutil.SecureObservedFunc(func(w http.ResponseWriter, r *http.Request) {
				routerState.ServeHTTP(w, r)
			}, "CoreApiHandler", true)
		},
	})
}

var getQueries = appdatabase.GetQueries
var loadConfig = loadCoreConfig

func loadCoreConfig(configPath string) (coreconfig.Config, error) {
	coreconfigsource.Install()
	return coreconfig.LoadConfig(configPath)
}

func NewRouter() (*chi.Mux, huma.API, bool) {
	r := chi.NewRouter()
	r.Use(handlerutil.ServiceHeader("core-api"))
	r.Use(observability.WithHTTPMetrics("core-api"))

	q, err := getQueries(context.Background())
	if err != nil {
		slog.Error("Failed to get DB queries for Core handlers", "error", err)
	}

	if q != nil {
		// Apply DB-backed auth middleware to all routes in this service.
		// This populates the context with the user (including IsAdmin) from the database.
		r.Use(func(next http.Handler) http.Handler {
			return dbauth.WithFlexibleAuth(q, next.ServeHTTP)
		})
	}

	// Rate limiting: 120 req/min per user (or IP if unauthenticated).
	// This must run after auth middleware so authenticated requests are keyed by user.
	r.Use(middleware.WithRateLimit(120, time.Minute))

	config := huma.DefaultConfig("TaskForceAI Core API", "1.0.0")
	api := humachi.New(r, config)

	// Always expose health/models routes, even when downstream dependencies are
	// unavailable during cold start.
	health.RegisterHandlers(api, func(ctx context.Context) error {
		_, err := getQueries(ctx)
		return err
	})

	if q == nil {
		registerAuxiliaryRoutes(r)
		return r, api, true
	}

	cfg, cfgErr := loadConfig("")
	if cfgErr != nil {
		slog.Error("Failed to load core config for Core handlers", "error", cfgErr)
		registerAuxiliaryRoutes(r)
		return r, api, true
	}

	adminRepo := adminpkg.NewRepository(adminQueriesAdapter{Queries: q})
	memService := memoriespkg.NewService(memoryadapters.NewStore(q), cfg)
	gdprService := platform.NewGdprService(gdprStoreAdapter{q: q})
	statusService := platform.NewStatusServiceWithSource(
		adminStatusSource{repo: adminRepo},
		newStatusPublisherFromEnv(),
	)
	identityService := identity.NewService(identityStoreAdapter{q: q})
	conversationspkg.SetConversationTelemetry(conversationadapters.NewTelemetry())
	convService := conversationspkg.NewConversationService(conversationspkg.NewConversationRepository(conversationadapters.NewStore(q)))
	downloadService := platform.NewDownloadService(downloadStoreAdapter{q: q}, newDownloadArtifactStoreFromEnv())
	var financeProvider corefinance.Provider
	if plaidClient, ok := corefinance.NewPlaidClientFromEnv(); ok {
		financeProvider = plaidClient
	}
	financeService := corefinance.NewServiceWithDependencies(
		corefinance.NewSQLStore(q.GetDB()),
		financeProvider,
		financeTokenProtector{},
		financeLinkConfigFromEnv(),
	)

	projectAuditLogger := auditpkg.NewAuditLogger(auditpkg.NewAuditLogRepository(q))
	projects.RegisterHandlers(api, projectspkg.NewService(projectStoreAdapter{q: q}, projectAuditAdapter{logger: projectAuditLogger}))
	artifactshandler.RegisterHandlers(api, artifactspkg.NewService(adapterartifacts.NewSQLStore(q)))
	conversations.RegisterHandlers(api, convService)
	conversations.RegisterFeedbackHandler(api, feedbackQueriesAdapter{q: q})
	conversations.RegisterShareHandler(api, conversationShareQueriesAdapter{q: q})
	memories.RegisterHandlers(api, memService)
	financehandler.RegisterHandlers(api, memService, financeService)
	status.RegisterHandlers(api, statusService)
	admin.RegisterHandlers(api, adminRepo, statusService)
	admin.RegisterTracesHandler(api, tracesQueriesAdapter{q: q})
	gdpr.RegisterHandlers(api, gdprService)
	org.RegisterHandlers(api, identityService)
	notifications.RegisterHandlers(api, notificationspkg.NewPushTokenService(sharednotifications.NewPushTokenStore(q)))
	publicshare.RegisterHandlers(api, publicShareQueriesAdapter{q: q})
	support.RegisterHandlers(api, email.DefaultService())
	download.RegisterHandlers(api, downloadService)
	desktopupdate.RegisterHandlers(api)

	bridgeProvider := newPulseBridgeProvider(q)
	agents.RegisterHandlers(api, newAgentStore(q), newAgentBridgeRegistryProvider(bridgeProvider))
	cron.RegisterPulseHandler(api, bridgeProvider)
	cron.RegisterStatusSnapshotHandler(api, statusService)

	registerAuxiliaryRoutes(r)
	return r, api, false
}

// NewRecoveringRouter returns a router that periodically rebuilds itself while
// startup dependencies or configuration are unavailable. This keeps the
// standalone server from getting permanently stuck on the reduced health-only
// router produced during a transient degraded startup.
func NewRecoveringRouter() (http.Handler, huma.API) {
	mux, api, degraded := NewRouter()
	state := newDegradedRouterState(mux, degraded, degradedRouterRefreshInterval, func() (http.Handler, bool) {
		refreshedMux, _, refreshedDegraded := NewRouter()
		return refreshedMux, refreshedDegraded
	})
	return state, api
}

func newAgentBridgeRegistryProvider(bridgeProvider func() (*pulsebridge.Bridge, error)) func() (agents.BridgeRegistry, error) {
	return func() (agents.BridgeRegistry, error) {
		bridge, err := bridgeProvider()
		if err != nil {
			return nil, err
		}
		return pulseBridgeAdapter{bridge: bridge}, nil
	}
}

func registerAuxiliaryRoutes(r *chi.Mux) {
	// Silence common noise requests (browsers, bots, crawlers)
	for _, route := range handlerutil.CommonRoutes() {
		r.HandleFunc(route.Pattern, route.Handler)
	}
	r.HandleFunc("/api/og", handlerutil.HandleNoContent)

	// Catch-all for debugging 404s
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		handlerutil.GetLogger().Warn("Route not found in Core service", map[string]any{
			"path":         r.URL.Path,
			"method":       r.Method,
			"__path":       r.URL.Query().Get("__path"),
			"matched_path": r.Header.Get("X-Matched-Path"),
		})
		handlerutil.JSONError(w, http.StatusNotFound, "Core route not found: "+r.URL.Path)
	})
}

func newPulseBridgeProvider(q *db.Queries) func() (*pulsebridge.Bridge, error) {
	resolve := lazy.Cached(func(ctx context.Context) (*pulsebridge.Bridge, error) {
		engineURL := os.Getenv("ENGINE_URL")
		if engineURL == "" {
			engineURL = "http://localhost:3005/api/v1/run/pulse"
		}
		engineToken := os.Getenv("INTERNAL_API_TOKEN")
		rClient, redisErr := infraredis.GetClient()
		if redisErr != nil {
			slog.Warn("Failed to initialize Redis client for pulse bridge", "error", redisErr)
		}
		newBridge := pulsebridge.NewBridgeWithRedis(ctx, pulseBridgeStoreAdapter{q: q}, rClient, engineURL, engineToken)
		if err := newBridge.Start(); err != nil {
			slog.Error("Failed to start pulse bridge", "error", err)
			return nil, err
		}
		return newBridge, nil
	})

	return func() (*pulsebridge.Bridge, error) {
		return resolve(context.Background())
	}
}
