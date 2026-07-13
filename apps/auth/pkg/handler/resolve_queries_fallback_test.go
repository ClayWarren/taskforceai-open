package handler

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResolveQueries_FallsBackToDBGetQueries(t *testing.T) {
	SetQueriesOverride(nil)
	t.Cleanup(func() { SetQueriesOverride(nil) })

	_, err := ResolveQueries(context.Background(), nil)
	assert.Error(t, err)
}
