package collections

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMap(t *testing.T) {
	assert.Equal(t, []string{"1", "2", "3"}, Map([]int{1, 2, 3}, strconv.Itoa))
	assert.Empty(t, Map([]int{}, strconv.Itoa))
}
