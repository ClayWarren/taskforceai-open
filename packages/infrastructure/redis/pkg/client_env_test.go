package redis

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func resetEnvClientState(t *testing.T) {
	t.Helper()
	ResetClient()
	t.Cleanup(ResetClient)
}

func TestNewClientFromEnv(t *testing.T) {
	resetEnvClientState(t)
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	if got := NewClientFromEnv(); got != nil {
		t.Fatalf("redis client = %v, want nil without env", got)
	}

	resetEnvClientState(t)
	server := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "redis://"+server.Addr())
	if got := NewClientFromEnv(EnvConfig{}); got == nil {
		t.Fatal("redis client = nil, want configured client")
	}

	resetEnvClientState(t)
	customServer := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	t.Setenv("CUSTOM_REDIS_URL", "redis://"+customServer.Addr())
	if got := NewClientFromEnv(EnvConfig{URLEnvVar: "CUSTOM_REDIS_URL"}); got == nil {
		t.Fatal("redis client = nil, want custom configured client")
	}

	resetEnvClientState(t)
	t.Setenv("CUSTOM_REDIS_URL", "://bad")
	if got := NewClientFromEnv(EnvConfig{URLEnvVar: "CUSTOM_REDIS_URL"}); got != nil {
		t.Fatal("redis client should be nil for invalid custom URL")
	}

	resetEnvClientState(t)
	t.Setenv("CUSTOM_REDIS_URL", "redis://"+customServer.Addr())
	t.Setenv("CUSTOM_REDIS_TOKEN", "secret")
	if got := NewClientFromEnv(EnvConfig{URLEnvVar: "CUSTOM_REDIS_URL", TokenEnvVar: "CUSTOM_REDIS_TOKEN"}); got == nil {
		t.Fatal("redis client = nil, want custom configured client with token")
	}
}
