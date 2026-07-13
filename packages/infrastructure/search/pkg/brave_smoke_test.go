//go:build brave_smoke

package pkg

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestBraveSearchSmoke(t *testing.T) {
	apiKey := strings.TrimSpace(os.Getenv("BRAVE_SEARCH_API_KEY"))
	if apiKey == "" {
		t.Fatal("BRAVE_SEARCH_API_KEY is required for brave_smoke")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	gateway, err := NewSearchGateway(BraveConfig{
		APIKey:    apiKey,
		UserAgent: "TaskForceAI smoke test",
	})
	if err != nil {
		t.Fatalf("create Brave search gateway: %v", err)
	}

	result, err := gateway.Search(ctx, SearchParams{
		Provider:       string(ProviderBrave),
		OriginalQuery:  "OpenAI official website",
		EffectiveQuery: "OpenAI official website",
		PrimaryQuery:   "OpenAI official website",
		MaxResults:     3,
		UserAgent:      "TaskForceAI smoke test",
	})
	if err != nil {
		t.Fatalf("Brave search failed: %v", err)
	}
	if result == nil || len(result.Results) == 0 {
		t.Fatalf("Brave search returned no results")
	}

	first := result.Results[0]
	if strings.TrimSpace(first.Title) == "" {
		t.Fatalf("Brave search first result has empty title: %#v", first)
	}
	if !strings.HasPrefix(first.URL, "http://") && !strings.HasPrefix(first.URL, "https://") {
		t.Fatalf("Brave search first result has invalid URL: %#v", first)
	}
	t.Logf("Brave search returned %d results; first=%q <%s>", len(result.Results), first.Title, first.URL)
}
