package configsource

import (
	"errors"
	"testing"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSource(t *testing.T) {
	wantSnapshot := enginecoreconfig.ConfigSnapshot{InlineContent: []byte("snapshot")}
	wantWritable := enginecoreconfig.ConfigDocument{Name: "config.json"}
	wantStoreError := errors.New("store failed")
	stored := []byte{}
	source := Source{
		Snapshot: wantSnapshot,
		Writable: wantWritable,
		StoreFunc: func(data []byte) error {
			stored = data
			return wantStoreError
		},
	}

	snapshot, err := source.Load()
	require.NoError(t, err)
	assert.Equal(t, wantSnapshot, snapshot)
	writable, err := source.LoadWritable()
	require.NoError(t, err)
	assert.Equal(t, wantWritable, writable)
	require.ErrorIs(t, source.Store([]byte("updated")), wantStoreError)
	assert.Equal(t, []byte("updated"), stored)
	require.ErrorIs(t, (Source{}).Store(nil), enginecoreconfig.ErrConfigSourceUnavailable)
}
