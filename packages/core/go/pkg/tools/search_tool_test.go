package tools

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type setErrorCache struct{}

func (setErrorCache) Get(context.Context, string) (string, error) {
	return "", errors.New("cache miss")
}

func (setErrorCache) Set(context.Context, string, string, time.Duration) error {
	return errors.New("set failed")
}

func (setErrorCache) Delete(context.Context, string) (bool, error) {
	return false, nil
}

func (setErrorCache) Take(context.Context, string) (string, error) {
	return "", errors.New("cache miss")
}

func (setErrorCache) Clear(context.Context) error {
	return nil
}

func TestSearchTool(t *testing.T) {
	cfg := config.Config{}
	gateway := &MockSearchGateway{
		results: []SearchResultItem{
			{Title: "Result 1", URL: "http://test.com", Snippet: "Snippet 1"},
		},
	}
	tool := CreateSearchTool(cfg, gateway, nil)
	ctx := context.Background()

	t.Run("Search success", func(t *testing.T) {
		args := `{"query": "test query", "max_results": 1}`
		res, err := tool.Execute(ctx, args)
		if err != nil {
			t.Fatal(err)
		}
		if res["success"] != true {
			t.Errorf("expected success true, got %v", res["success"])
		}
		results, ok := res["results"].([]SearchResultItem)
		if !ok {
			t.Fatalf("expected results to be []SearchResultItem, got %T", res["results"])
		}
		if len(results) != 1 || results[0].Title != "Result 1" {
			t.Errorf("unexpected results: %v", results)
		}
	})

	t.Run("Search failure", func(t *testing.T) {
		gateway.err = fmt.Errorf("search failed")
		args := `{"query": "test query"}`
		res, err := tool.Execute(ctx, args)
		if err != nil {
			t.Fatal(err)
		}
		if res["error"] != "search failed" {
			t.Errorf("expected error 'search failed', got %v", res["error"])
		}
	})

	t.Run("Search with cache", func(t *testing.T) {
		gateway.err = nil
		mockCache := &MockCache{Data: make(map[string]string)}
		toolWithCache := CreateSearchTool(cfg, gateway, mockCache)

		args := `{"query": "cache query"}`

		// First call (miss)
		_, _ = toolWithCache.Execute(ctx, args)

		// Second call (hit)
		res, err := toolWithCache.Execute(ctx, args)
		require.NoError(t, err)
		fromCache, ok := res["from_cache"].(bool)
		assert.True(t, ok)
		if !ok {
			t.Fatalf("expected from_cache to be bool, got %T", res["from_cache"])
		}
		assert.True(t, fromCache)
		assert.True(t, fromCache)
	})

	t.Run("Search ignores malformed cache entry", func(t *testing.T) {
		gateway := &MockSearchGateway{
			results: []SearchResultItem{{Title: "Fresh", URL: "http://test.com", Snippet: "Snippet"}},
		}
		mockCache := &MockCache{Data: map[string]string{
			"search:corrupt query:5": "not-json",
		}}
		toolWithCache := CreateSearchTool(cfg, gateway, mockCache)

		res, err := toolWithCache.Execute(ctx, `{"query": "corrupt query"}`)
		require.NoError(t, err)
		assert.True(t, res["success"].(bool))
		assert.Nil(t, res["from_cache"])
		if assert.Len(t, gateway.params, 1) {
			assert.Equal(t, "corrupt query", gateway.params[0].OriginalQuery)
		}
	})

	t.Run("Search uses configured max results by default", func(t *testing.T) {
		gateway := &MockSearchGateway{
			results: []SearchResultItem{{Title: "Result", URL: "http://test.com", Snippet: "Snippet"}},
		}
		tool := CreateSearchTool(config.Config{
			Search: config.SearchConfig{MaxResults: 12},
		}, gateway, nil)

		res, err := tool.Execute(ctx, `{"query": "deeper query"}`)
		require.NoError(t, err)
		assert.True(t, res["success"].(bool))
		if assert.Len(t, gateway.params, 1) {
			assert.Equal(t, 12, gateway.params[0].MaxResults)
		}
	})

	t.Run("Search defaults to five results without config", func(t *testing.T) {
		gateway := &MockSearchGateway{
			results: []SearchResultItem{{Title: "Result", URL: "http://test.com", Snippet: "Snippet"}},
		}
		tool := CreateSearchTool(config.Config{}, gateway, nil)

		res, err := tool.Execute(ctx, `{"query": "default query"}`)
		require.NoError(t, err)
		assert.True(t, res["success"].(bool))
		if assert.Len(t, gateway.params, 1) {
			assert.Equal(t, 5, gateway.params[0].MaxResults)
		}
	})

	t.Run("Search clamps overlarge max results", func(t *testing.T) {
		gateway := &MockSearchGateway{
			results: []SearchResultItem{{Title: "Result", URL: "http://test.com", Snippet: "Snippet"}},
		}
		tool := CreateSearchTool(config.Config{}, gateway, nil)

		res, err := tool.Execute(ctx, `{"query": "huge query", "max_results": 500}`)
		require.NoError(t, err)
		assert.True(t, res["success"].(bool))
		if assert.Len(t, gateway.params, 1) {
			assert.Equal(t, 20, gateway.params[0].MaxResults)
		}
	})

	t.Run("Search invalid json", func(t *testing.T) {
		res, err := tool.Execute(ctx, "invalid")
		require.Error(t, err)
		assert.Nil(t, res)
	})

	t.Run("Search zero results", func(t *testing.T) {
		gateway.err = nil
		gateway.results = nil
		args := `{"query": "nothing"}`
		res, err := tool.Execute(ctx, args)
		require.NoError(t, err)
		success, ok := res["success"].(bool)
		assert.True(t, ok)
		assert.False(t, success)
		errStr, ok := res["error"].(string)
		assert.True(t, ok)
		assert.Contains(t, errStr, "No search results found")
	})

	t.Run("Search cache marshal and set failures still return results", func(t *testing.T) {
		gateway := &MockSearchGateway{
			results: []SearchResultItem{{Title: "Fresh", URL: "http://test.com", Snippet: "Snippet"}},
		}
		toolWithCache := CreateSearchTool(cfg, gateway, setErrorCache{})

		res, err := toolWithCache.Execute(ctx, `{"query": "cache set failure"}`)
		require.NoError(t, err)
		assert.True(t, res["success"].(bool))

		previousMarshal := marshalSearchResults
		t.Cleanup(func() { marshalSearchResults = previousMarshal })
		marshalSearchResults = func(any) ([]byte, error) {
			return nil, errors.New("marshal failed")
		}
		res, err = toolWithCache.Execute(ctx, `{"query": "cache marshal failure"}`)
		require.NoError(t, err)
		assert.True(t, res["success"].(bool))
	})
}
