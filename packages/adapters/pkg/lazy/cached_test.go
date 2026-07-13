package lazy

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCachedBuildsOnceAfterSuccess(t *testing.T) {
	calls := 0
	resolve := Cached(func(context.Context) (int, error) {
		calls++
		return 42, nil
	})

	first, err := resolve(context.Background())
	require.NoError(t, err)
	second, err := resolve(context.Background())
	require.NoError(t, err)

	assert.Equal(t, 42, first)
	assert.Equal(t, 42, second)
	assert.Equal(t, 1, calls)
}

func TestCachedRetriesAfterError(t *testing.T) {
	calls := 0
	resolve := Cached(func(context.Context) (int, error) {
		calls++
		if calls == 1 {
			return 0, errors.New("temporary")
		}
		return 7, nil
	})

	_, err := resolve(context.Background())
	require.Error(t, err)
	value, err := resolve(context.Background())
	require.NoError(t, err)

	assert.Equal(t, 7, value)
	assert.Equal(t, 2, calls)
}
