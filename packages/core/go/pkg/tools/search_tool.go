package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/platform"
)

type SearchArgs struct {
	Query      string `json:"query" validate:"required"`
	MaxResults int    `json:"max_results" validate:"omitempty,min=0,max=500"`
}

const (
	defaultSearchMaxResults = 5
	searchMaxResultsLimit   = 20
)

var marshalSearchResults = json.Marshal

func CreateSearchTool(cfg config.Config, gateway ISearchGateway, c cache.ICache) ITool {
	defaultMaxResults := normalizeSearchMaxResults(0, cfg.Search.MaxResults)
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "Search query keywords",
			},
			"max_results": map[string]any{
				"type":        "integer",
				"description": fmt.Sprintf("Maximum number of web results to return. Defaults to %d. Values above %d are clamped to %d.", defaultMaxResults, searchMaxResultsLimit, searchMaxResultsLimit),
				"minimum":     1,
				"maximum":     searchMaxResultsLimit,
				"default":     defaultMaxResults,
			},
		},
		Required: []string{"query"},
	}

	return NewBaseTool(
		"search_web",
		`Search the web for real-time information using Brave Search.

IMPORTANT: You MUST call this tool when:
- The user asks about current events, news, weather, or recent developments
- The user asks about anything that happened after your knowledge cutoff
- The user asks what happened "today", "this week", "this month", or "recently"
- You need up-to-date information that may have changed

Do NOT rely on your internal knowledge for dates after your training cutoff. Always search for current information.`,
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			var input SearchArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, err
			}
			if err := util.ValidateStruct(&input); err != nil {
				return nil, fmt.Errorf("invalid arguments: %w", err)
			}
			input.MaxResults = normalizeSearchMaxResults(input.MaxResults, cfg.Search.MaxResults)

			// Simple caching logic for now
			cacheKey := fmt.Sprintf("search:%s:%d", cache.NormalizeQuery(input.Query), input.MaxResults)
			if c != nil {
				if val, err := c.Get(ctx, cacheKey); err == nil {
					var cachedResults []SearchResultItem
					if err := json.Unmarshal([]byte(val), &cachedResults); err == nil {
						return ToolResult{
							"results":    cachedResults,
							"success":    true,
							"from_cache": true,
						}, nil
					} else {
						platform.GetLogger().Warn("Failed to decode cached search results", "cacheKey", cacheKey, "error", err)
					}
				}
			}

			searchParams := SearchParams{
				Provider:       "brave", // Default to brave for now
				OriginalQuery:  input.Query,
				EffectiveQuery: input.Query,
				PrimaryQuery:   input.Query,
				MaxResults:     input.MaxResults,
				UserAgent:      "Mozilla/5.0 (compatible; TaskForceAI Agent)",
			}

			res, err := gateway.Search(ctx, searchParams)
			if err != nil {
				return searchErrorResult(input.Query, err), nil
			}

			if len(res.Results) == 0 {
				return ToolResult{
					"error":   fmt.Sprintf("No search results found for query: %s", input.Query),
					"success": false,
					"query":   input.Query,
				}, nil
			}

			if c != nil {
				val, err := marshalSearchResults(res.Results)
				if err != nil {
					platform.GetLogger().Warn("Failed to encode search results for cache", "resultCount", len(res.Results), "error", err)
				} else if err := c.Set(ctx, cacheKey, string(val), 3600); err != nil {
					platform.GetLogger().Warn("Failed to cache search results", "resultCount", len(res.Results), "error", err)
				}
			}

			return ToolResult{
				"results": res.Results,
				"success": true,
				"count":   len(res.Results),
			}, nil
		},
	)
}

func normalizeSearchMaxResults(requested, configured int) int {
	maxResults := requested
	if maxResults <= 0 {
		maxResults = configured
	}
	if maxResults <= 0 {
		maxResults = defaultSearchMaxResults
	}
	if maxResults > searchMaxResultsLimit {
		return searchMaxResultsLimit
	}
	return maxResults
}

func searchErrorResult(query string, err error) ToolResult {
	return ToolResult{
		"error":   err.Error(),
		"success": false,
		"query":   query,
	}
}
