package handler

import (
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	loggerenv "github.com/TaskForceAI/logger/pkg/env"
)

func init() {
	adapterhandler.SetLogger(loggerenv.InstallLogger(loggerenv.LoggerOptions{
		ServiceName:      "auth-service",
		ContextExtractor: adapterhandler.ContextLogArgs,
	}))
	adapterhandler.SetPanicReporter(loggerenv.SentryPanicReporter{})
	adapterhandler.SetRedisClientFactory(newAPIRedisClient)
}

var getRedisClientForAPI = infraredis.GetClient

func newAPIRedisClient() (adapterhandler.RedisClient, error) {
	client, err := getRedisClientForAPI()
	if err != nil {
		return nil, err
	}
	return client, nil
}
