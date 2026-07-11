package handler

import (
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	loggerenv "github.com/TaskForceAI/logger/pkg/env"
)

func init() {
	adapterhandler.SetLogger(loggerenv.InstallLogger(loggerenv.LoggerOptions{
		ServiceName:      "billing-service",
		ContextExtractor: adapterhandler.ContextLogArgs,
	}))
	adapterhandler.SetPanicReporter(loggerenv.SentryPanicReporter{})
	adapterhandler.SetRedisClientFactory(func() (adapterhandler.RedisClient, error) {
		client, err := infraredis.GetClient()
		if err != nil {
			return nil, err
		}
		return client, nil
	})
}
