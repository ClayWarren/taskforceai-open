package db

import (
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQueriesGetDB(t *testing.T) {
	mockPool, err := pgxmock.NewPool()
	require.NoError(t, err)
	t.Cleanup(mockPool.Close)

	q := New(mockPool)
	assert.Same(t, mockPool, q.GetDB())
}
