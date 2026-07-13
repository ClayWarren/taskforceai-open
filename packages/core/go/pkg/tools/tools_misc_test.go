package tools

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolsMiscFinalPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("discover tools registers sandbox pool tools and github token", func(t *testing.T) {
		pool := &SandboxPool{authConfigured: true}
		registry := DiscoverTools(config.Config{}, nil, nil, pool, true, "gh-token")
		for _, name := range []string{"execute_code", "computer_use"} {
			if _, ok := registry.Get(name); !ok {
				t.Fatalf("expected %q to be registered when sandbox pool is provided", name)
			}
		}
	})

	t.Run("search tool validates required query", func(t *testing.T) {
		tool := CreateSearchTool(config.Config{}, &MockSearchGateway{}, nil)
		res, err := tool.Execute(context.Background(), `{}`)
		require.Error(t, err)
		assert.Nil(t, res)
	})

	t.Run("search tool defaults max results and ignores corrupt cache entries", func(t *testing.T) {
		gateway := &MockSearchGateway{
			results: []SearchResultItem{{Title: "Hit", URL: "https://example.com", Snippet: "ok"}},
		}
		mockCache := &MockCache{Data: map[string]string{
			"search:cache query:20": "not-json",
		}}
		tool := CreateSearchTool(config.Config{}, gateway, mockCache)

		res, err := tool.Execute(context.Background(), `{"query":"cache query","max_results":0}`)
		require.NoError(t, err)
		assert.Equal(t, true, res["success"])
		assert.NotNil(t, res["results"])
	})

	t.Run("task done tool rejects invalid arguments", func(t *testing.T) {
		tool := CreateTaskDoneTool()
		res, err := tool.Execute(context.Background(), `{"task_summary":"","completion_message":""}`)
		require.Error(t, err)
		assert.Nil(t, res)
	})
}
