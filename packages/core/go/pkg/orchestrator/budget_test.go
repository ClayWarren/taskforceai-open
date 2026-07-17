package orchestrator

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBudgetManager(t *testing.T) {
	t.Run("Unlimited Budget", func(t *testing.T) {
		bm := NewBudgetManager(nil)
		usage := bm.GetUsage()
		assert.True(t, usage.Ok)
		assert.Equal(t, 0, usage.Value.Initial)

		err := bm.WithBudget("test", func() error { return nil })
		assert.NoError(t, err)
	})

	t.Run("USD Budget", func(t *testing.T) {
		limit := 10.0
		bm := NewBudgetManager(nil)
		bm.SetUSDBudget(&limit)

		bm.RecordCost(1.5)
		usage := bm.GetUsage()
		assert.True(t, usage.Ok)
		assert.Equal(t, 10.0, *usage.Value.InitialUSD)
		assert.Equal(t, 1.5, usage.Value.ConsumedUSD)
		assert.Equal(t, 8.5, *usage.Value.RemainingUSD)

		// Test enforcement
		bm.RecordCost(9.0) // Total 10.5
		err := bm.WithBudget("test", func() error { return nil })
		require.Error(t, err)
		assert.Contains(t, err.Error(), "USD budget exceeded")
	})

	t.Run("USD budget enforces sequential calls", func(t *testing.T) {
		limit := 0.02
		bm := NewBudgetManager(nil)
		bm.SetUSDBudget(&limit)

		err := bm.WithBudget("call1", func() error { return nil })
		require.NoError(t, err)
		err = bm.WithBudget("call2", func() error { return nil })
		require.NoError(t, err)
		err = bm.WithBudget("call3", func() error { return nil })
		require.Error(t, err)
		assert.Contains(t, err.Error(), "USD budget exceeded")

		usage := bm.GetUsage()
		require.True(t, usage.Ok)
		assert.InDelta(t, 0.02, usage.Value.ConsumedUSD, 0.000001)
		require.NotNil(t, usage.Value.RemainingUSD)
		assert.InDelta(t, 0.0, *usage.Value.RemainingUSD, 0.000001)
	})

	t.Run("Limited Budget", func(t *testing.T) {
		limit := 2
		bm := NewBudgetManager(&limit)

		err := bm.WithBudget("call1", func() error { return nil })
		require.NoError(t, err)

		err = bm.WithBudget("call2", func() error { return nil })
		require.NoError(t, err)

		err = bm.WithBudget("call3", func() error { return nil })
		require.Error(t, err)
		assert.Contains(t, err.Error(), "budget exceeded")
	})

	t.Run("Usage Tracking", func(t *testing.T) {
		limit := 10
		bm := NewBudgetManager(&limit)
		limit = 99
		_ = bm.WithBudget("test", func() error { return nil })

		res := bm.GetUsage()
		assert.True(t, res.Ok)
		assert.Equal(t, 10, res.Value.Initial)
		assert.Equal(t, 9, res.Value.Remaining)
		assert.Equal(t, 1, res.Value.Consumed)
	})

	t.Run("USD Budget Clones Caller Pointer", func(t *testing.T) {
		limit := 2.0
		bm := NewBudgetManager(nil)
		bm.SetUSDBudget(&limit)
		limit = 0.0

		res := bm.GetUsage()
		require.True(t, res.Ok)
		require.NotNil(t, res.Value.InitialUSD)
		assert.Equal(t, 2.0, *res.Value.InitialUSD)
	})

	t.Run("Error Propagation", func(t *testing.T) {
		bm := NewBudgetManager(nil)
		expectedErr := errors.New("boom")
		err := bm.WithBudget("test", func() error { return expectedErr })
		assert.Equal(t, expectedErr, err)
	})

	t.Run("Spawn Availability", func(t *testing.T) {
		unlimited := NewBudgetManager(nil)
		require.NoError(t, unlimited.CheckSpawnAvailable())

		callLimit := 1
		calls := NewBudgetManager(&callLimit)
		require.NoError(t, calls.WithBudget("consume", func() error { return nil }))
		require.ErrorContains(t, calls.CheckSpawnAvailable(), "LLM call budget exhausted")

		usdLimit := 1.0
		usd := NewBudgetManager(nil)
		usd.SetUSDBudget(&usdLimit)
		usd.RecordCost(usdLimit)
		require.ErrorContains(t, usd.CheckSpawnAvailable(), "organization USD budget exhausted")
	})
}
