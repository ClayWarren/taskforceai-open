package webhooks

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMarkEventAsProcessed_NilStore(t *testing.T) {
	duplicate, err := markEventAsProcessed(context.Background(), nil, "evt", time.Hour)
	require.NoError(t, err)
	assert.False(t, duplicate)
}

func TestMarkEventAsProcessed_MissingEventID(t *testing.T) {
	store := &replayStoreStub{}
	_, err := markEventAsProcessed(context.Background(), store, "", time.Hour)
	assert.Error(t, err)
}

func TestMarkEventAsProcessed_DefaultTTL(t *testing.T) {
	store := &replayStoreStub{setNXResult: true}
	duplicate, err := markEventAsProcessed(context.Background(), store, "evt", 0)
	require.NoError(t, err)
	assert.False(t, duplicate)
}

func TestMarkEventAsProcessed_DuplicateEvent(t *testing.T) {
	store := &replayStoreStub{setNXResult: false}
	duplicate, err := markEventAsProcessed(context.Background(), store, "evt", time.Hour)
	require.NoError(t, err)
	assert.True(t, duplicate)
}

func TestMarkEventAsProcessed_SetNXError(t *testing.T) {
	store := &replayStoreStub{setNXErr: errors.New("redis down")}
	_, err := markEventAsProcessed(context.Background(), store, "evt", time.Hour)
	assert.Error(t, err)
}

func TestIsProductionEnv(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	assert.True(t, isProductionEnv())

	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "production")
	assert.True(t, isProductionEnv())

	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL", "1")
	assert.True(t, isProductionEnv())
}
