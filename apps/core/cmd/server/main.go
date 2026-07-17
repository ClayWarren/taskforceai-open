package main

import (
	"sync"
	"time"

	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/adapters/pkg/server/topology"
	handler "github.com/TaskForceAI/go-core/api"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"log/slog"
)

func main() {
	slog.Info("Core API: Starting main")
	server.Run(serverConfig())
}

func serverConfig() server.Config {
	shutdownGroup := &sync.WaitGroup{}
	router, humaAPI := handler.NewRecoveringRouter()
	secureRouter := handlerutil.SecurityHandler(router, true)

	return server.Config{
		ServiceName: topology.Get(topology.Core).ServiceName,
		DefaultPort: topology.Get(topology.Core).DefaultPort,
		Router:      secureRouter,
		HumaAPI:     humaAPI,
		InitTracer:  observability.InitTracer,
		InitMeter:   observability.InitMeter,
		StartupChecks: []server.StartupCheck{
			{
				Name:  "database",
				Check: postgres.HealthCheck,
			},
			{
				Name:  "redis",
				Check: server.RedisCheck(redis.GetClient, "core:start:health"),
			},
		},
		StartupWaitTimeout: 30 * time.Second,
		StartupRetryDelay:  2 * time.Second,
		ShutdownTimeout:    30 * time.Second,
		ShutdownGroup:      shutdownGroup,
	}
}
