package redis

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMockClientCheckRateLimitsConsumesBothOrNeither(t *testing.T) {
	ctx := context.Background()
	client := NewMockClient()
	firstAllowed, firstRemaining, _, secondAllowed, secondRemaining, _, err := client.CheckRateLimits(
		ctx, "first", 1, time.Hour, "second", 1, time.Hour,
	)
	require.NoError(t, err)
	assert.True(t, firstAllowed)
	assert.True(t, secondAllowed)
	assert.Zero(t, firstRemaining)
	assert.Zero(t, secondRemaining)

	firstAllowed, _, _, secondAllowed, _, _, err = client.CheckRateLimits(
		ctx, "first", 1, time.Hour, "third", 1, time.Hour,
	)
	require.NoError(t, err)
	assert.False(t, firstAllowed)
	assert.True(t, secondAllowed)

	allowed, _, _, err := client.CheckRateLimit(ctx, "third", 1, time.Hour)
	require.NoError(t, err)
	assert.True(t, allowed, "the second scope must not be consumed when the first scope is denied")
}
