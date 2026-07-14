package main

import (
	"context"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/adapters/pkg/server/topology"
	handler "github.com/TaskForceAI/billing-service/api"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"sync"
	"time"
)

var getRedisClient = redis.GetClient

func redisStartupCheck(ctx context.Context) error {
	return server.RedisCheck(getRedisClient, "billing:start:health")(ctx)
}

func main() {
	shutdownGroup := &sync.WaitGroup{}
	router, humaAPI := handler.NewRouter()

	server.Run(server.Config{
		ServiceName: topology.Get(topology.Billing).ServiceName,
		DefaultPort: topology.Get(topology.Billing).DefaultPort,
		Router:      router,
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
				Check: redisStartupCheck,
			},
		},
		StartupWaitTimeout: 30 * time.Second,
		StartupRetryDelay:  2 * time.Second,
		ShutdownTimeout:    30 * time.Second,
		ShutdownGroup:      shutdownGroup,
	})
}
