package logging

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithLogContext(t *testing.T) {
	ctx := context.Background()

	t.Run("NewContext", func(t *testing.T) {
		val := LogContextValue{
			CorrelationID: "123",
			Metadata:      map[string]any{"key": "value"},
		}
		newCtx := WithLogContext(ctx, val)

		retrieved, ok := GetLogContext(newCtx)
		assert.True(t, ok)
		assert.Equal(t, "123", retrieved.CorrelationID)
		assert.Equal(t, "value", retrieved.Metadata["key"])
	})

	t.Run("MergeContext", func(t *testing.T) {
		val1 := LogContextValue{
			CorrelationID: "123",
			Metadata:      map[string]any{"key1": "value1"},
		}
		ctx1 := WithLogContext(ctx, val1)

		val2 := LogContextValue{
			Metadata: map[string]any{"key2": "value2"},
		}
		ctx2 := WithLogContext(ctx1, val2)

		retrieved, ok := GetLogContext(ctx2)
		assert.True(t, ok)
		assert.Equal(t, "123", retrieved.CorrelationID) // Inherited
		assert.Equal(t, "value1", retrieved.Metadata["key1"])
		assert.Equal(t, "value2", retrieved.Metadata["key2"])
	})

	t.Run("OverrideCorrelationID", func(t *testing.T) {
		val1 := LogContextValue{CorrelationID: "123"}
		ctx1 := WithLogContext(ctx, val1)

		val2 := LogContextValue{CorrelationID: "456"}
		ctx2 := WithLogContext(ctx1, val2)

		assert.Equal(t, "456", GetCorrelationID(ctx2))
	})
}

func TestGetCorrelationID(t *testing.T) {
	ctx := context.Background()
	assert.Empty(t, GetCorrelationID(ctx))

	ctx = WithLogContext(ctx, LogContextValue{CorrelationID: "abc"})
	assert.Equal(t, "abc", GetCorrelationID(ctx))
}

func TestGetLogMetadata(t *testing.T) {
	ctx := context.Background()
	assert.Empty(t, GetLogMetadata(ctx))

	ctx = WithLogContext(ctx, LogContextValue{Metadata: map[string]any{"a": 1}})
	meta := GetLogMetadata(ctx)
	assert.Equal(t, 1, meta["a"])

	meta["a"] = 2
	metaAgain := GetLogMetadata(ctx)
	assert.Equal(t, 1, metaAgain["a"])
}

func TestGetLogContext_ReturnsImmutableCopy(t *testing.T) {
	ctx := WithLogContext(context.Background(), LogContextValue{
		CorrelationID: "corr-123",
		Metadata: map[string]any{
			"key": "value",
		},
	})

	retrieved, ok := GetLogContext(ctx)
	assert.True(t, ok)
	retrieved.CorrelationID = "changed"
	retrieved.Metadata["key"] = "mutated"

	retrievedAgain, ok := GetLogContext(ctx)
	assert.True(t, ok)
	assert.Equal(t, "corr-123", retrievedAgain.CorrelationID)
	assert.Equal(t, "value", retrievedAgain.Metadata["key"])
}

func TestCloneMetadataNil(t *testing.T) {
	assert.Nil(t, cloneMetadata(nil))
}
