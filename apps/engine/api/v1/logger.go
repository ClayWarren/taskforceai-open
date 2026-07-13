package stream

import (
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	loggerenv "github.com/TaskForceAI/logger/pkg/env"
)

func init() {
	adapterhandler.SetLogger(loggerenv.InstallLogger(loggerenv.LoggerOptions{
		ServiceName:      "engine-server",
		ContextExtractor: adapterhandler.ContextLogArgs,
	}))
	adapterhandler.SetPanicReporter(loggerenv.SentryPanicReporter{})
	adapterhandler.SetRedisClientFactory(newStreamRedisClient)
}

var getRedisClientForStream = infraredis.GetClient

func newStreamRedisClient() (adapterhandler.RedisClient, error) {
	client, err := getRedisClientForStream()
	if err != nil {
		return nil, err
	}
	return client, nil
}
