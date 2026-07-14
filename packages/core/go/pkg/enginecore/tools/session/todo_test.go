package session

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestToolTodo(t *testing.T) {
	ctx := protocol.ToolContext{
		Todo: NewTodoStore(),
	}

	t.Run("todo write and read", func(t *testing.T) {
		todos := []any{
			map[string]any{
				"id":       "1",
				"content":  "task 1",
				"status":   "pending",
				"priority": "high",
			},
		}
		args := map[string]any{"todos": todos}

		// Write
		resW := ExecuteTodoWrite(ctx, args)
		assert.Equal(t, "completed", resW.Status)
		assert.Equal(t, "1 todos", resW.Title)

		// Read
		resR := ExecuteTodoRead(ctx, nil)
		assert.Equal(t, "completed", resR.Status)
		assert.Equal(t, "1 todos", resR.Title)

		readTodos, ok := resR.Metadata["todos"].([]map[string]any)
		assert.True(t, ok)
		assert.Len(t, readTodos, 1)
		assert.Equal(t, "task 1", readTodos[0]["content"])
	})

	t.Run("todo write invalid", func(t *testing.T) {
		args := map[string]any{"todos": []any{map[string]any{"invalid": "item"}}}
		res := ExecuteTodoWrite(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "invalid todos")
	})

	t.Run("store set does not alias caller map", func(t *testing.T) {
		store := NewTodoStore()
		item := map[string]any{
			"id":       "1",
			"content":  "original",
			"status":   "pending",
			"priority": "high",
		}
		store.Set([]map[string]any{item})
		item["content"] = "mutated"

		got := store.Get()
		assert.Equal(t, "original", got[0]["content"])
	})

	t.Run("store get returns deep copies", func(t *testing.T) {
		store := NewTodoStore()
		store.Set([]map[string]any{
			{
				"id":       "1",
				"content":  "original",
				"status":   "pending",
				"priority": "high",
			},
		})

		first := store.Get()
		first[0]["content"] = "mutated"
		second := store.Get()
		assert.Equal(t, "original", second[0]["content"])
	})

	t.Run("clone store handles nil and does not alias source", func(t *testing.T) {
		nilClone := CloneTodoStore(nil)
		assert.NotNil(t, nilClone)
		assert.Empty(t, nilClone.Get())

		store := NewTodoStore()
		store.Set([]map[string]any{
			nil,
			{
				"id":       "1",
				"content":  "original",
				"status":   "pending",
				"priority": "high",
			},
		})

		cloned := CloneTodoStore(store)
		sourceItems := store.Get()
		sourceItems[1]["content"] = "mutated-source-copy"

		clonedItems := cloned.Get()
		assert.Nil(t, clonedItems[0])
		assert.Equal(t, "original", clonedItems[1]["content"])

		clonedItems[1]["content"] = "mutated-clone-copy"
		assert.Equal(t, "original", cloned.Get()[1]["content"])
		assert.Equal(t, "original", store.Get()[1]["content"])
	})
}
