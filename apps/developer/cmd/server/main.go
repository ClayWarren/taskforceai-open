package main

import (
	"context"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/adapters/pkg/server/topology"
	handler "github.com/TaskForceAI/developer-service/api"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"sync"
	"time"
)

var (
	getRedisClient = redis.GetClient
)

func databaseStartupCheck(ctx context.Context) error {
	return postgres.HealthCheck(ctx)
}

func redisStartupCheck(ctx context.Context) error {
	return server.RedisCheck(getRedisClient, "developer:start:health")(ctx)
}

func main() {
	server.Run(buildServerConfig())
}

func buildServerConfig() server.Config {
	shutdownGroup := &sync.WaitGroup{}
	router, humaAPI := handler.NewRouter()

	return server.Config{
		ServiceName: topology.Get(topology.Developer).ServiceName,
		DefaultPort: topology.Get(topology.Developer).DefaultPort,
		Router:      adapterhandler.SecureObservedHandler(router, "DeveloperServerHandler", false),
		HumaAPI:     humaAPI,
		InitTracer:  observability.InitTracer,
		InitMeter:   observability.InitMeter,
		StartupChecks: []server.StartupCheck{
			{Name: "database", Check: databaseStartupCheck},
			{Name: "redis", Check: redisStartupCheck},
		},
		StartupWaitTimeout: 30 * time.Second,
		StartupRetryDelay:  2 * time.Second,
		ShutdownTimeout:    30 * time.Second,
		ShutdownGroup:      shutdownGroup,
	}
}
