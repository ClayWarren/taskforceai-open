package json

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

type TestUser struct {
	Name string `json:"name"`
	Age  int    `json:"age"`
}

func TestParseJSON(t *testing.T) {
	t.Run("ParseJSONSchema - Success", func(t *testing.T) {
		raw := `{"name":"Alice","age":30}`
		res := ParseJSONSchema[TestUser](raw)
		assert.True(t, res.Ok)
		assert.Equal(t, "Alice", res.Value.Name)
	})

	t.Run("ParseJSONSchema - Invalid JSON", func(t *testing.T) {
		raw := `{"name":`
		res := ParseJSONSchema[TestUser](raw)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidJSON, res.Error)
	})

	t.Run("ParseJSONSchema - Empty", func(t *testing.T) {
		res := ParseJSONSchema[TestUser]("")
		assert.False(t, res.Ok)
		assert.Equal(t, ErrEmptyInput, res.Error)
	})

	t.Run("ParseJSONSchema - Invalid Schema", func(t *testing.T) {
		// age is int, providing string
		raw := `{"name":"Alice","age":"too-old"}`
		res := ParseJSONSchema[TestUser](raw)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidSchema, res.Error)
	})

	t.Run("ParseJSONValueSchema - Object", func(t *testing.T) {
		val := map[string]any{"foo": "bar"}
		res := ParseJSONValueSchema[map[string]any](val)
		assert.True(t, res.Ok)
		assert.Equal(t, "bar", res.Value["foo"])
	})

	t.Run("ParseJSONValueSchema - Nil", func(t *testing.T) {
		res := ParseJSONValueSchema[any](nil)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrEmptyInput, res.Error)
	})

	t.Run("ParseJSONValueSchema - Marshal Error", func(t *testing.T) {
		res := ParseJSONValueSchema[any](make(chan int))
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidJSON, res.Error)
	})

	t.Run("ParseJSONValueSchema - String", func(t *testing.T) {
		res := ParseJSONValueSchema[map[string]any](`{"foo": "bar"}`)
		assert.True(t, res.Ok)
		assert.Equal(t, "bar", res.Value["foo"])
	})
}
