package cache

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mapTestCache struct {
	values map[string]string
}

func newMapTestCache() *mapTestCache {
	return &mapTestCache{values: map[string]string{}}
}

func (m *mapTestCache) Get(_ context.Context, key string) (string, error) {
	value, ok := m.values[key]
	if !ok {
		return "", ErrNotFound
	}
	return value, nil
}

func (m *mapTestCache) Set(_ context.Context, key string, value string, _ time.Duration) error {
	m.values[key] = value
	return nil
}

func (m *mapTestCache) Delete(_ context.Context, key string) (bool, error) {
	_, ok := m.values[key]
	delete(m.values, key)
	return ok, nil
}

func (m *mapTestCache) Take(_ context.Context, key string) (string, error) {
	value, err := m.Get(context.Background(), key)
	if err != nil {
		return "", err
	}
	delete(m.values, key)
	return value, nil
}

func (m *mapTestCache) Clear(context.Context) error {
	m.values = map[string]string{}
	return nil
}

func TestLLMCache(t *testing.T) {
	mem := newMapTestCache()
	llm := NewLLMCache(mem)
	ctx := context.Background()

	prompt := "Say hello"
	model := "gpt-4"
	result := "Hello!"

	// 1. Set
	err := llm.Set(ctx, prompt, model, result, time.Minute)
	require.NoError(t, err)

	// 2. Get
	val, err := llm.Get(ctx, prompt, model)
	require.NoError(t, err)
	assert.Equal(t, result, val)

	// 3. Cache Miss
	val2, err := llm.Get(ctx, "other", model)
	require.Error(t, err)
	assert.Empty(t, val2)
}

func TestLLMCacheScopedIsolation(t *testing.T) {
	mem := newMapTestCache()
	llm := NewLLMCache(mem)
	ctx := context.Background()

	prompt := "Summarize my project"
	model := "gpt-4"
	userAResult := "Sensitive User A memory"

	err := llm.SetScoped(ctx, "user:1", prompt, model, userAResult, time.Minute)
	require.NoError(t, err)

	val, err := llm.GetScoped(ctx, "user:1", prompt, model)
	require.NoError(t, err)
	assert.Equal(t, userAResult, val)

	otherUserVal, err := llm.GetScoped(ctx, "user:2", prompt, model)
	require.Error(t, err)
	assert.Empty(t, otherUserVal)
}

func TestLLMCacheHashKeyLengthPrefixesFields(t *testing.T) {
	llm := NewLLMCache(newMapTestCache())
	prompt := "shared prompt"

	first := llm.hashKey("org:5", prompt, "model")
	second := llm.hashKey("org", prompt, "5:model")

	assert.NotEqual(t, first, second)
}
