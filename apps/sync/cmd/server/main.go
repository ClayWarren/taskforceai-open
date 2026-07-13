package main

import (
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/adapters/pkg/server/topology"
	handler "github.com/TaskForceAI/go-sync/api"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"sync"
	"time"
)

func main() {
	server.Run(buildServerConfig())
}

func buildServerConfig() server.Config {
	shutdownGroup := &sync.WaitGroup{}
	router, humaAPI := handler.NewRouter()
	secureRouter := handlerutil.SecurityHandler(router, true)

	return server.Config{
		ServiceName: topology.Get(topology.Sync).ServiceName,
		DefaultPort: topology.Get(topology.Sync).DefaultPort,
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
				Check: server.RedisCheck(redis.GetClient, "sync:start:health"),
			},
		},
		StartupWaitTimeout: 30 * time.Second,
		StartupRetryDelay:  2 * time.Second,
		ShutdownTimeout:    30 * time.Second,
		ShutdownGroup:      shutdownGroup,
	}
}
