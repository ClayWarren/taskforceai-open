package main

import (
	"context"
	"net/http"
	"sync"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/adapters/pkg/server/topology"
	handler "github.com/TaskForceAI/auth-service/api"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
)

func buildSecureRouter() (http.Handler, huma.API) {
	router, humaAPI := handler.NewRouter()
	if err := authhandler.ValidateSecureEnv(); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			authhandler.JSONError(w, http.StatusInternalServerError, "Server misconfiguration")
		}), humaAPI
	}
	return adapterhandler.SecureObservedHandler(router, "AuthServerHandler", true), humaAPI
}

func databaseStartupCheck(ctx context.Context) error {
	return postgres.HealthCheck(ctx)
}

func redisStartupCheck(ctx context.Context) error {
	return server.RedisCheck(redis.GetClient, "auth:start:health")(ctx)
}

func runServer(shutdownGroup *sync.WaitGroup) {
	secureRouter, humaAPI := buildSecureRouter()
	server.Run(server.Config{
		ServiceName: topology.Get(topology.Auth).ServiceName,
		DefaultPort: topology.Get(topology.Auth).DefaultPort,
		Router:      secureRouter,
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
	})
}
