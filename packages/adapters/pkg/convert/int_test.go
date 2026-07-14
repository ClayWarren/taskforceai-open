package convert

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInt32(t *testing.T) {
	value, err := Int32(42, "id")
	require.NoError(t, err)
	assert.Equal(t, int32(42), value)

	_, err = Int32(math.MaxInt32+1, "id")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id exceeds int32 range")
}

func TestClampInt32(t *testing.T) {
	assert.Equal(t, int32(math.MinInt32), ClampInt32(math.MinInt32-1))
	assert.Equal(t, int32(42), ClampInt32(42))
	assert.Equal(t, int32(math.MaxInt32), ClampInt32(math.MaxInt32+1))
}

func TestCapInt32(t *testing.T) {
	assert.Equal(t, math.MinInt32-1, CapInt32(math.MinInt32-1))
	assert.Equal(t, 42, CapInt32(42))
	assert.Equal(t, math.MaxInt32, CapInt32(math.MaxInt32+1))
}

func TestInt32Slice(t *testing.T) {
	values, err := Int32Slice([]int{1, 2}, "key_id")
	require.NoError(t, err)
	assert.Equal(t, []int32{1, 2}, values)

	_, err = Int32Slice([]int{1, math.MaxInt32 + 1}, "key_id")
	require.Error(t, err)
}
