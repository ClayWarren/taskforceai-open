package mocks

import (
	"context"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestCmdable_Eval_VariadicArgsExpandForExpectations(t *testing.T) {
	m := NewCmdable(t)
	cmd := goredis.NewCmd(context.Background())

	m.On("Eval", mock.Anything, "return ARGV[1]", []string{"lock:key"}, "lock-value").Return(cmd).Once()

	res := m.Eval(context.Background(), "return ARGV[1]", []string{"lock:key"}, "lock-value")
	assert.NoError(t, res.Err())
}

func TestCmdable_RunScript_VariadicArgsExpandForExpectations(t *testing.T) {
	m := NewCmdable(t)
	cmd := goredis.NewCmd(context.Background())
	script := goredis.NewScript("return ARGV[1]")

	m.On("RunScript", mock.Anything, script, []string{"lock:key"}, "lock-value").Return(cmd).Once()

	res := m.RunScript(context.Background(), script, []string{"lock:key"}, "lock-value")
	assert.NoError(t, res.Err())
}

func TestCmdable_Watch_VariadicKeysExpandForExpectations(t *testing.T) {
	m := NewCmdable(t)

	m.On("Watch", mock.Anything, mock.Anything, "lock:key").Return(nil).Once()

	err := m.Watch(context.Background(), nil, "lock:key")
	assert.NoError(t, err)
}

func TestCmdable_OptionalRateLimitMethods(t *testing.T) {
	m := NewCmdable(t)
	resetAt := time.Now().Add(time.Minute)

	m.On("SupportsEval").Return(true).Once()
	assert.True(t, m.SupportsEval())

	m.On("IncrWithExpire", mock.Anything, "counter", time.Minute).Return(2, nil).Once()
	count, err := m.IncrWithExpire(context.Background(), "counter", time.Minute)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	m.On("CheckRateLimit", mock.Anything, "rl:user", 3, time.Minute).Return(true, 1, resetAt, nil).Once()
	allowed, remaining, gotResetAt, err := m.CheckRateLimit(context.Background(), "rl:user", 3, time.Minute)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 1, remaining)
	assert.Equal(t, resetAt, gotResetAt)
}
