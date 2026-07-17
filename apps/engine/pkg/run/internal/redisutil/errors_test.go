package redisutil

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

type evalSupport bool

func (s evalSupport) SupportsEval() bool { return bool(s) }

func TestRedisErrorHelpers(t *testing.T) {
	assert.False(t, IsKeyNotFoundError(nil))
	assert.True(t, IsKeyNotFoundError(errors.New("KEY NOT FOUND")))
	assert.True(t, IsKeyNotFoundError(errors.New("redis: nil")))
	assert.False(t, IsKeyNotFoundError(errors.New("other")))

	assert.True(t, SupportsEval(evalSupport(true)))
	assert.False(t, SupportsEval(evalSupport(false)))
	assert.False(t, SupportsEval(struct{}{}))

	assert.True(t, IsStreamUnavailableError(errors.New("stream operations require REDIS_URL")))
	assert.False(t, IsStreamUnavailableError(nil))
	assert.False(t, IsStreamUnavailableError(errors.New("other")))
}
