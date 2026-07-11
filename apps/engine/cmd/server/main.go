package main

import (
	"context"
	"errors"
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/adapters/pkg/server/topology"
	ff "github.com/TaskForceAI/feature-flags/pkg"
	handler "github.com/TaskForceAI/go-engine/api"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"os"
	"strings"
	"sync"
	"time"
)

func main() {
	shutdownGroup := &sync.WaitGroup{}
	server.Run(buildServerConfig(shutdownGroup))
}

func buildServerConfig(shutdownGroup *sync.WaitGroup) server.Config {
	router, humaAPI := handler.NewRouter(shutdownGroup)
	secureRouter := handlerutil.SecurityHandler(router, true)

	return server.Config{
		ServiceName: topology.Get(topology.Engine).ServiceName,
		DefaultPort: topology.Get(topology.Engine).DefaultPort,
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
				Check: server.RedisCheck(redis.GetClient, "engine:start:health"),
			},
			{
				Name: "inngest",
				Check: func(ctx context.Context) error {
					key := os.Getenv("INNGEST_EVENT_KEY")
					devMode := strings.TrimSpace(os.Getenv("INNGEST_DEV")) != ""
					if key == "" && !devMode {
						return errors.New("INNGEST_EVENT_KEY not set")
					}
					return nil
				},
			},
			{
				Name: "ai-gateway",
				Check: func(ctx context.Context) error {
					url := os.Getenv("VERCEL_AI_GATEWAY_URL")
					if url == "" {
						url = "https://ai-gateway.vercel.sh/v1"
					}
					if !strings.HasPrefix(url, "http") {
						return errors.New("invalid VERCEL_AI_GATEWAY_URL")
					}
					return nil
				},
			},
			{
				Name: "brave-search",
				Check: func(ctx context.Context) error {
					if os.Getenv("BRAVE_SEARCH_API_KEY") == "" {
						return errors.New("BRAVE_SEARCH_API_KEY not set")
					}
					return nil
				},
			},
			{
				Name: "statsig",
				Check: func(ctx context.Context) error {
					key := os.Getenv("STATSIG_SECRET_KEY")
					if key != "" {
						ff.GetClient(key)
					}
					return nil
				},
			},
		},
		StartupWaitTimeout: 30 * time.Second,
		StartupRetryDelay:  2 * time.Second,
		WriteTimeout:       server.VercelFunctionServerWriteTimeout,
		ShutdownTimeout:    60 * time.Second,
		ShutdownGroup:      shutdownGroup,
	}
}
