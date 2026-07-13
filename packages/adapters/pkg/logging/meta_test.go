package logging

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoggingMeta(t *testing.T) {
	t.Run("BuildBaseLogMeta", func(t *testing.T) {
		meta := BaseLogMeta{App: "test", Service: "api", Runtime: "go"}
		res := BuildBaseLogMeta(meta)
		assert.Equal(t, "test", res["app"])
		assert.Equal(t, "go", res["runtime"])
	})

	t.Run("BuildBaseLogMeta without runtime", func(t *testing.T) {
		meta := BaseLogMeta{App: "test", Service: "api"}
		res := BuildBaseLogMeta(meta)
		assert.Equal(t, "test", res["app"])
		_, hasRuntime := res["runtime"]
		assert.False(t, hasRuntime)
	})

	t.Run("NormalizeMeta", func(t *testing.T) {
		base := map[string]any{"app": "test"}
		ctx := map[string]any{"cid": "123"}

		// Map meta
		m := map[string]any{"foo": "bar"}
		res := NormalizeMeta(base, ctx, m)
		assert.Equal(t, "test", res["app"])
		assert.Equal(t, "123", res["cid"])
		assert.Equal(t, "bar", res["foo"])
	})

	t.Run("NormalizeMeta with nil meta", func(t *testing.T) {
		base := map[string]any{"app": "test"}
		ctx := map[string]any{"cid": "123"}
		res := NormalizeMeta(base, ctx, nil)
		assert.Equal(t, "test", res["app"])
		assert.Equal(t, "123", res["cid"])
	})

	t.Run("NormalizeMeta with nil meta and empty maps", func(t *testing.T) {
		res := NormalizeMeta(nil, nil, nil)
		assert.Nil(t, res)
	})

	t.Run("NormalizeMeta with error", func(t *testing.T) {
		base := map[string]any{"app": "test"}
		err := errors.New("test error")
		res := NormalizeMeta(base, nil, err)
		assert.NotNil(t, res["error"])
		errMap, ok := res["error"].(map[string]any)
		assert.True(t, ok)
		if !ok {
			t.Fatalf("expected error metadata to be map[string]any, got %T", res["error"])
		}
		assert.Equal(t, "test error", errMap["message"])
	})

	t.Run("NormalizeMeta with struct", func(t *testing.T) {
		base := map[string]any{"app": "test"}
		type TestStruct struct {
			Name string `json:"name"`
			Age  int    `json:"age"`
		}
		s := TestStruct{Name: "John", Age: 30}
		res := NormalizeMeta(base, nil, s)
		assert.Equal(t, "test", res["app"])
		assert.Equal(t, "John", res["name"])
		assert.Equal(t, float64(30), res["age"]) // JSON numbers are float64
	})

	t.Run("NormalizeMeta with non-struct value", func(t *testing.T) {
		base := map[string]any{"app": "test"}
		res := NormalizeMeta(base, nil, "simple string")
		assert.Equal(t, "test", res["app"])
		assert.Equal(t, "simple string", res["detail"])
	})

	t.Run("NormalizeMeta with int value", func(t *testing.T) {
		base := map[string]any{"app": "test"}
		res := NormalizeMeta(base, nil, 42)
		assert.Equal(t, "test", res["app"])
		assert.Equal(t, 42, res["detail"])
	})
}

func TestIsRecord(t *testing.T) {
	t.Run("returns true for map[string]any", func(t *testing.T) {
		m := map[string]any{"key": "value"}
		assert.True(t, IsRecord(m))
	})

	t.Run("returns false for string", func(t *testing.T) {
		assert.False(t, IsRecord("string"))
	})

	t.Run("returns false for int", func(t *testing.T) {
		assert.False(t, IsRecord(42))
	})

	t.Run("returns false for nil", func(t *testing.T) {
		assert.False(t, IsRecord(nil))
	})
}

func TestLogContext(t *testing.T) {
	ctx := context.Background()
	val := LogContextValue{CorrelationID: "corr-1", Metadata: map[string]any{"u": "1"}}

	newCtx := WithLogContext(ctx, val)

	assert.Equal(t, "corr-1", GetCorrelationID(newCtx))
	assert.Equal(t, "1", GetLogMetadata(newCtx)["u"])
}

func TestNormalizeMeta_UnmarshalError(t *testing.T) {
	// Save original and restore after test
	originalUnmarshal := unmarshalFunc
	defer func() { unmarshalFunc = originalUnmarshal }()

	// Override with failing function
	unmarshalFunc = func(data []byte, v any) error {
		return errors.New("unmarshal error")
	}

	// Use a struct that marshals to JSON object
	type TestStruct struct {
		Name string `json:"name"`
	}

	base := map[string]any{"app": "test"}
	res := NormalizeMeta(base, nil, TestStruct{Name: "test"})

	// Should fall back to putting the original value in "detail"
	assert.Equal(t, "test", res["app"])
	assert.NotNil(t, res["detail"])
}
