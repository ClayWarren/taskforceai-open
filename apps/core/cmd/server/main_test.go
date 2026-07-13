package main

import (
	"context"
	"os"
	"testing"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMainFunction_OpenAPI(t *testing.T) {
	oldArgs := os.Args
	os.Args = []string{"server", "--openapi"}
	t.Setenv("DATABASE_URL", "")
	defer func() { os.Args = oldArgs }()

	main()
}

func TestServerConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(redis.ResetClient)

	config := serverConfig()

	assert.Equal(t, "Core API", config.ServiceName)
	assert.NotEmpty(t, config.DefaultPort)
	require.NotNil(t, config.Router)
	require.NotNil(t, config.HumaAPI)
	require.NotNil(t, config.ShutdownGroup)
	require.Len(t, config.StartupChecks, 2)
	assert.Equal(t, "database", config.StartupChecks[0].Name)
	assert.Equal(t, "redis", config.StartupChecks[1].Name)
	assert.Equal(t, "30s", config.StartupWaitTimeout.String())
	assert.Equal(t, "2s", config.StartupRetryDelay.String())
	assert.Equal(t, "30s", config.ShutdownTimeout.String())
}

func TestServerStartupChecks(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(redis.ResetClient)

	config := serverConfig()

	dbErr := config.StartupChecks[0].Check(context.Background())
	require.Error(t, dbErr)
	assert.Contains(t, dbErr.Error(), "DATABASE_URL")

	require.NoError(t, config.StartupChecks[1].Check(context.Background()))

	redis.ResetClient()
	redisErr := config.StartupChecks[1].Check(context.Background())
	require.Error(t, redisErr)
}
