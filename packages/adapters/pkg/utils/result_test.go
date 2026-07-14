package utils

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResult(t *testing.T) {
	t.Run("Ok", func(t *testing.T) {
		res := Ok("hello")
		assert.True(t, res.Ok)
		assert.Equal(t, "hello", res.Value)
		require.NoError(t, res.Error)
		assert.True(t, IsOk(res))
		assert.False(t, IsErr(res))
	})

	t.Run("Err", func(t *testing.T) {
		err := errors.New("fail")
		res := Err[string](err)
		assert.False(t, res.Ok)
		assert.Empty(t, res.Value)
		assert.Equal(t, err, res.Error)
		assert.False(t, IsOk(res))
		assert.True(t, IsErr(res))
	})
}
