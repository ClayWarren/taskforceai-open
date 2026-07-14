package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSliceStream(t *testing.T) {
	events := []Event{
		{Type: "text"},
		{Type: "tool_call"},
	}
	s := NewSliceStream(events)

	ev, ok, err := s.Next()
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, EventType("text"), ev.Type)

	ev, ok, err = s.Next()
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, EventType("tool_call"), ev.Type)

	ev, ok, err = s.Next()
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Empty(t, ev.Type)
}

func TestProcessorSetModel(t *testing.T) {
	p := NewProcessorWithIDs(".", nil)
	p.SetModel(ProviderModel{ModelID: "test"})
	assert.Equal(t, "test", p.model.ModelID)

	p.SetCostCalculator(nil)
	assert.Nil(t, p.cost)
}
