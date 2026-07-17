package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTruncate(t *testing.T) {
	assert.Equal(t, "hello...", Truncate("hello world", 8))
	assert.Equal(t, "hello", Truncate("hello", 10))
	assert.Equal(t, "..", Truncate("hello", 2))
	assert.Equal(t, ".", Truncate("hello", 1))
	assert.Empty(t, Truncate("hello", -1))
	assert.Equal(t, "éé", Truncate("éé", 3))
}

var benchmarkTextResult string

func BenchmarkTruncateNoopASCII(b *testing.B) {
	for b.Loop() {
		benchmarkTextResult = Truncate("TaskForceAI", 32)
	}
}

func BenchmarkTruncateLongASCII(b *testing.B) {
	for b.Loop() {
		benchmarkTextResult = Truncate("TaskForceAI developer platform synchronization pipeline", 24)
	}
}

func BenchmarkTruncateLongUnicode(b *testing.B) {
	for b.Loop() {
		benchmarkTextResult = Truncate("TaskForceAI developer platform synchronization pipeline 世界", 24)
	}
}
