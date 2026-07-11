package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUnique(t *testing.T) {
	assert.Equal(t, []int{1, 2, 3}, Unique([]int{1, 2, 2, 3, 3, 3}))
	assert.Equal(t, []string{"a", "b"}, Unique([]string{"a", "b", "a"}))
}

func TestChunk(t *testing.T) {
	assert.Equal(t, [][]int{{1, 2}, {3, 4}, {5}}, Chunk([]int{1, 2, 3, 4, 5}, 2))
	assert.Nil(t, Chunk([]int{1, 2, 3}, 0))
}

func TestIsEmpty(t *testing.T) {
	assert.True(t, IsEmpty(map[string]int{}))
	assert.False(t, IsEmpty(map[string]int{"a": 1}))
}

func TestGroupBy(t *testing.T) {
	type user struct {
		name string
		role string
	}
	users := []user{
		{name: "Alice", role: "admin"},
		{name: "Bob", role: "user"},
		{name: "Charlie", role: "user"},
	}
	grouped := GroupBy(users, func(u user) string { return u.role })

	assert.Len(t, grouped["admin"], 1)
	assert.Len(t, grouped["user"], 2)
	assert.Equal(t, "Alice", grouped["admin"][0].name)
}
