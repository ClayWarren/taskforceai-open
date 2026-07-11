package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelLLMStream(t *testing.T) {
	t.Run("push and next", func(t *testing.T) {
		s := NewChannelLLMStream()
		s.Push(LLMEvent{Type: LLMText, Text: "hi"})

		ev, ok, err := s.Next()
		require.NoError(t, err)
		assert.True(t, ok)
		assert.Equal(t, "hi", ev.Text)
	})

	t.Run("close", func(t *testing.T) {
		s := NewChannelLLMStream()
		go func() {
			time.Sleep(10 * time.Millisecond)
			s.Close()
		}()

		_, ok, err := s.Next()
		require.NoError(t, err)
		assert.False(t, ok)
	})

	t.Run("timeout", func(t *testing.T) {
		s := NewChannelLLMStreamWithTimeout(10 * time.Millisecond)
		_, ok, err := s.Next()
		require.Error(t, err)
		assert.False(t, ok)
		assert.Equal(t, ErrLLMStreamTimeout, err)
	})

	t.Run("blocking mode drains and ignores pushes after close", func(t *testing.T) {
		s := NewChannelLLMStreamWithTimeout(0)
		s.SetWaitTimeout(0)
		s.Push(LLMEvent{Type: LLMText, Text: "first"})
		s.Close()
		s.Push(LLMEvent{Type: LLMText, Text: "ignored"})

		ev, ok, err := s.Next()
		require.NoError(t, err)
		assert.True(t, ok)
		assert.Equal(t, "first", ev.Text)

		_, ok, err = s.Next()
		require.NoError(t, err)
		assert.False(t, ok)
	})
}
