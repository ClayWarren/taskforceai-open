package pkg

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	bravesearch "github.com/claywarren/go-brave-search"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestNewSearchGateway(t *testing.T) {
	g, err := NewSearchGateway(BraveConfig{APIKey: "k"})
	require.NoError(t, err)
	assert.NotNil(t, g)
	assert.Equal(t, "k", g.config.APIKey)
}

func TestNewSearchGatewayWithoutAPIKey(t *testing.T) {
	g, err := NewSearchGateway(BraveConfig{})
	require.NoError(t, err)
	assert.NotNil(t, g)
	assert.Nil(t, g.braveClient)
}

func TestNewSearchGatewayUsesConfiguredBraveEndpoint(t *testing.T) {
	requested := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = true
		assert.Equal(t, "/custom/web/search", r.URL.Path)
		assert.Equal(t, "effective endpoint", r.URL.Query().Get("q"))
		assert.Equal(t, "TaskForceAI test", r.UserAgent())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"type":"search","web":{"results":[{"title":"Configured","url":"https://example.com","description":"From configured endpoint"}]}}`))
	}))
	defer server.Close()

	g, err := NewSearchGateway(BraveConfig{
		APIKey:   "key",
		Endpoint: server.URL + "/custom/web/search",
	})
	require.NoError(t, err)
	assert.NotNil(t, g)

	mockClient := new(MockHttpClient)
	mockClient.On("Get", mock.Anything, mock.MatchedBy(func(url string) bool {
		return strings.Contains(url, "pubchem")
	}), map[string]string{"User-Agent": "TaskForceAI test"}).Return([]byte(`{"InformationList":{"Information":[]}}`), 200, nil).Once()
	g.httpClient = mockClient

	res, err := g.Search(context.Background(), SearchParams{
		OriginalQuery:  "caffeine solubility configured endpoint",
		EffectiveQuery: "effective endpoint",
		MaxResults:     1,
		UserAgent:      "TaskForceAI test",
	})

	require.NoError(t, err)
	assert.True(t, requested)
	assert.Len(t, res.Results, 1)
	assert.Equal(t, "Configured", res.Results[0].Title)
	mockClient.AssertExpectations(t)
}

func TestNewSearchGatewayReturnsBraveClientError(t *testing.T) {
	originalFactory := newBraveSearcher
	t.Cleanup(func() {
		newBraveSearcher = originalFactory
	})
	expectedErr := errors.New("brave constructor failed")
	newBraveSearcher = func(BraveConfig, string) (BraveSearcher, error) {
		return nil, expectedErr
	}

	g, err := NewSearchGateway(BraveConfig{
		APIKey: "key",
	})

	require.ErrorIs(t, err, expectedErr)
	assert.Nil(t, g)
}

func TestSearchGatewayUsesOnlyOuterRetryForBrave(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		http.Error(w, "upstream unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	g, err := NewSearchGateway(BraveConfig{
		APIKey:   "key",
		Endpoint: server.URL + "/web/search",
	})
	require.NoError(t, err)

	mockClient := new(MockHttpClient)
	mockClient.On("Get", mock.Anything, mock.MatchedBy(func(url string) bool {
		return strings.Contains(url, "pubchem")
	}), mock.Anything).Return([]byte(`{"InformationList":{"Information":[]}}`), 200, nil).Once()
	g.httpClient = mockClient

	res, err := g.Search(context.Background(), SearchParams{
		OriginalQuery:  "caffeine transient outage",
		EffectiveQuery: "transient outage",
		MaxResults:     1,
	})

	require.Error(t, err)
	assert.Nil(t, res)
	assert.Equal(t, 2, requests)
	mockClient.AssertExpectations(t)
}

func TestBraveSearcherForBoundsUserAgentCache(t *testing.T) {
	defaultClient := &MockBraveClient{}
	created := 0
	gateway := &SearchGateway{
		config:      BraveConfig{APIKey: "key", UserAgent: "TaskForceAI default"},
		braveClient: defaultClient,
		braveClientFactory: func(userAgent string) (BraveSearcher, error) {
			created++
			return &MockBraveClient{}, nil
		},
		braveClients: map[string]BraveSearcher{
			"TaskForceAI default": defaultClient,
		},
	}

	for i := 0; i < maxCachedBraveUserAgents+4; i++ {
		client, err := gateway.braveSearcherFor(fmt.Sprintf("TaskForceAI test/%d", i))
		require.NoError(t, err)
		require.NotNil(t, client)
	}

	assert.LessOrEqual(t, len(gateway.braveClients), maxCachedBraveUserAgents)
	assert.LessOrEqual(t, created, maxCachedBraveUserAgents-1)
}

func TestEffectiveUserAgentDropsOversizedConfigFallback(t *testing.T) {
	gateway := &SearchGateway{
		config: BraveConfig{UserAgent: strings.Repeat("a", maxSearchUserAgentBytes+1)},
	}

	// An empty request UA falls back to the configured UA, which is itself
	// oversized, so the effective UA collapses to empty.
	if got := gateway.effectiveUserAgent(""); got != "" {
		t.Fatalf("expected empty effective user agent, got %q", got)
	}
}

func TestAppendSearchResults(t *testing.T) {
	item := func(id string) SearchResultItem { return SearchResultItem{Title: id} }

	// Nothing to append.
	got, added := appendSearchResults([]SearchResultItem{item("a")}, nil, 5)
	if added || len(got) != 1 {
		t.Fatalf("expected no append, got added=%v len=%d", added, len(got))
	}

	// Already at capacity: remaining <= 0.
	existing := []SearchResultItem{item("a"), item("b")}
	got, added = appendSearchResults(existing, []SearchResultItem{item("c")}, 2)
	if added || len(got) != 2 {
		t.Fatalf("expected capacity rejection, got added=%v len=%d", added, len(got))
	}

	// Incoming exceeds remaining capacity: truncated to the remaining slots.
	got, added = appendSearchResults(nil, []SearchResultItem{item("a"), item("b"), item("c")}, 2)
	if !added || len(got) != 2 {
		t.Fatalf("expected truncation to 2, got added=%v len=%d", added, len(got))
	}

	// No cap: append everything.
	got, added = appendSearchResults([]SearchResultItem{item("a")}, []SearchResultItem{item("b")}, 0)
	if !added || len(got) != 2 {
		t.Fatalf("expected uncapped append, got added=%v len=%d", added, len(got))
	}
}

func TestBraveSearcherForRejectsOversizedUserAgentCacheKey(t *testing.T) {
	defaultClient := &MockBraveClient{}
	gateway := &SearchGateway{
		config:      BraveConfig{APIKey: "key", UserAgent: "TaskForceAI default"},
		braveClient: defaultClient,
		braveClientFactory: func(userAgent string) (BraveSearcher, error) {
			return &MockBraveClient{}, nil
		},
		braveClients: map[string]BraveSearcher{
			"TaskForceAI default": defaultClient,
		},
	}

	client, err := gateway.braveSearcherFor(strings.Repeat("a", maxSearchUserAgentBytes+1))

	require.NoError(t, err)
	assert.Same(t, defaultClient, client)
	assert.Len(t, gateway.braveClients, 1)
}

func TestBraveSearcherForMissingAPIKeyDoesNotCallFactory(t *testing.T) {
	gateway := &SearchGateway{
		config: BraveConfig{},
		braveClientFactory: func(userAgent string) (BraveSearcher, error) {
			return nil, errors.New("factory should not be called")
		},
		braveClients: map[string]BraveSearcher{},
	}

	client, err := gateway.braveSearcherFor("TaskForceAI custom")

	require.NoError(t, err)
	assert.Nil(t, client)
}

func TestSearchGatewayFallsBackToPubChemWhenBraveClientFactoryFails(t *testing.T) {
	getPubChemCircuitBreaker().Reset()
	defaultClient := &MockBraveClient{}
	mockClient := new(MockHttpClient)
	gateway := &SearchGateway{
		config:      BraveConfig{APIKey: "key", UserAgent: "TaskForceAI default"},
		httpClient:  mockClient,
		braveClient: defaultClient,
		braveClientFactory: func(userAgent string) (BraveSearcher, error) {
			return nil, errors.New("invalid brave user agent")
		},
		braveClients: map[string]BraveSearcher{
			"TaskForceAI default": defaultClient,
		},
	}
	mockClient.On("Get", mock.Anything, mock.MatchedBy(func(url string) bool {
		return strings.Contains(url, "pubchem")
	}), map[string]string{"User-Agent": "TaskForceAI custom"}).Return([]byte(`{"InformationList":{"Information":[{"CID":123,"Synonym":["water"]}]}}`), 200, nil).Once()

	res, err := gateway.Search(context.Background(), SearchParams{
		OriginalQuery: "ethanol",
		UserAgent:     "TaskForceAI custom",
	})

	require.NoError(t, err)
	require.NotNil(t, res)
	require.Len(t, res.Results, 1)
	assert.Equal(t, "pubchem", res.ProviderLabel)
	assert.Equal(t, "PubChem data for ethanol", res.Results[0].Title)
	assert.Equal(t, "https://pubchem.ncbi.nlm.nih.gov/compound/123", res.Results[0].URL)
	mockClient.AssertExpectations(t)
}

func TestIsSearchRetryableError(t *testing.T) {
	assert.False(t, isSearchRetryableError(nil))
	assert.False(t, isSearchRetryableError(errors.New("bad request")))
	assert.True(t, isSearchRetryableError(errors.New("upstream timeout")))
}

func TestSearchProviderLabel(t *testing.T) {
	assert.Empty(t, searchProviderLabel(false, false))
	assert.Equal(t, "brave", searchProviderLabel(true, false))
	assert.Equal(t, "pubchem", searchProviderLabel(false, true))
	assert.Equal(t, "brave,pubchem", searchProviderLabel(true, true))
}

func TestSearchGateway(t *testing.T) {
	mockClient := new(MockHttpClient)
	gateway := &SearchGateway{
		config:     BraveConfig{APIKey: "key"},
		httpClient: mockClient,
	}

	t.Run("Search - Brave without configured client", func(t *testing.T) {
		mockClient.On("Get", mock.Anything, mock.MatchedBy(func(url string) bool {
			return strings.Contains(url, "pubchem")
		}), mock.Anything).Return([]byte(`{"InformationList":{"Information":[]}}`), 200, nil).Once()

		params := SearchParams{
			Provider:      "brave",
			OriginalQuery: "benzene",
		}
		res, err := gateway.Search(context.Background(), params)

		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "brave search client is not configured")
	})

	t.Run("Search - Brave with PubChem results", func(t *testing.T) {
		// PubChem returns results (brave is nil so no brave results)
		mockClient.On("Get", mock.Anything, mock.MatchedBy(func(url string) bool {
			return strings.Contains(url, "pubchem")
		}), mock.Anything).Return([]byte(`{"InformationList":{"Information":[{"CID":456,"Synonym":["syn1"]}]}}`), 200, nil).Once()

		params := SearchParams{
			Provider:      "brave",
			OriginalQuery: "benzene",
		}
		res, err := gateway.Search(context.Background(), params)

		require.NoError(t, err)
		assert.Equal(t, "pubchem", res.ProviderLabel)
		assert.Len(t, res.Results, 1) // PubChem result only (no braveClient)
	})

	t.Run("FetchBraveResults Errors", func(t *testing.T) {
		// Nil client error
		_, err := FetchBraveResults(context.Background(), nil, "q", 5)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not configured")
	})

	t.Run("FetchPubChemResultsWithUserAgent more Edge Cases", func(t *testing.T) {
		// 404
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return(nil, 404, nil).Once()
		res, err := FetchPubChemResultsWithUserAgent(context.Background(), mockClient, "q", nil, "")
		require.NoError(t, err)
		assert.Empty(t, res)

		// Non-200
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return(nil, 500, nil).Once()
		res2, err := FetchPubChemResultsWithUserAgent(context.Background(), mockClient, "q", nil, "")
		require.Error(t, err)
		assert.Nil(t, res2)

		// Unmarshal error
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return([]byte("{"), 200, nil).Once()
		res3, err := FetchPubChemResultsWithUserAgent(context.Background(), mockClient, "q", nil, "")
		require.Error(t, err)
		assert.Nil(t, res3)

		// Client.Get error
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return(nil, 0, fmt.Errorf("error")).Once()
		res4, err := FetchPubChemResultsWithUserAgent(context.Background(), mockClient, "q", nil, "")
		require.Error(t, err)
		assert.Nil(t, res4)

		// More than 5 synonyms - should truncate
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return([]byte(`{"InformationList":{"Information":[{"CID":123,"Synonym":["s1","s2","s3","s4","s5","s6","s7"]}]}}`), 200, nil).Once()
		res5, err := FetchPubChemResultsWithUserAgent(context.Background(), mockClient, "q", nil, "")
		require.NoError(t, err)
		assert.Len(t, res5, 1)
		// Snippet should only contain first 5 synonyms
		assert.Contains(t, res5[0].Snippet, "s5")
		assert.NotContains(t, res5[0].Snippet, "s6")
	})

	t.Run("Search - Unknown Provider", func(t *testing.T) {
		// Unknown provider falls back to brave (which has nil client), then pubchem
		mockClient.On("Get", mock.Anything, mock.MatchedBy(func(url string) bool {
			return strings.Contains(url, "pubchem")
		}), mock.Anything).Return([]byte(`{"InformationList":{"Information":[]}}`), 200, nil).Once()

		params := SearchParams{
			Provider:      "unknown",
			OriginalQuery: "benzene",
		}
		res, err := gateway.Search(context.Background(), params)
		require.Error(t, err)
		assert.Nil(t, res)
	})

	t.Run("Search - Resilient when PubChem fails", func(t *testing.T) {
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return(nil, 0, fmt.Errorf("pubchem fail")).Once()

		params := SearchParams{OriginalQuery: "benzene"}
		res, err := gateway.Search(context.Background(), params)
		require.Error(t, err)
		assert.Nil(t, res)
	})

	t.Run("Search - With Brave Success", func(t *testing.T) {
		mockBrave := new(MockBraveClient)
		validResp := &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{
				Results: []bravesearch.SearchResult{
					{Title: "Brave 1", URL: "url1"},
				},
			},
		}
		mockBrave.On("WebSearch", mock.Anything, "benzene", mock.Anything).Return(validResp, nil).Once()

		gatewayWithBrave := &SearchGateway{
			config:      BraveConfig{APIKey: "key"},
			httpClient:  mockClient,
			braveClient: mockBrave,
		}

		// PubChem empty
		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return([]byte(`{"InformationList":{"Information":[]}}`), 200, nil).Once()

		params := SearchParams{OriginalQuery: "benzene"}
		res, err := gatewayWithBrave.Search(context.Background(), params)
		require.NoError(t, err)
		assert.Len(t, res.Results, 1)
		assert.Equal(t, "brave", res.ProviderLabel)
		assert.Equal(t, "Brave 1", res.Results[0].Title)
	})

	t.Run("Search - Brave no results returns empty result set", func(t *testing.T) {
		mockBrave := new(MockBraveClient)
		mockBrave.On("WebSearch", mock.Anything, "empty", mock.Anything).Return(&bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: []bravesearch.SearchResult{}},
		}, nil).Once()

		gatewayWithBrave := &SearchGateway{
			config:      BraveConfig{APIKey: "key"},
			httpClient:  mockClient,
			braveClient: mockBrave,
		}

		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return([]byte(`{"InformationList":{"Information":[]}}`), 200, nil).Once()

		res, err := gatewayWithBrave.Search(context.Background(), SearchParams{OriginalQuery: "empty", MaxResults: 1})

		require.NoError(t, err)
		require.NotNil(t, res)
		assert.Empty(t, res.Results)
		assert.Empty(t, res.ProviderLabel)
		mockBrave.AssertExpectations(t)
	})

	t.Run("Search - MaxResults caps combined providers", func(t *testing.T) {
		mockBrave := new(MockBraveClient)
		validResp := &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{
				Results: []bravesearch.SearchResult{
					{Title: "Brave first", URL: "url1"},
				},
			},
		}
		mockBrave.On("WebSearch", mock.Anything, "capped", mock.Anything).Return(validResp, nil).Once()

		gatewayWithBrave := &SearchGateway{
			config:      BraveConfig{APIKey: "key"},
			httpClient:  mockClient,
			braveClient: mockBrave,
		}

		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return([]byte(`{"InformationList":{"Information":[{"CID":456,"Synonym":["syn1"]}]}}`), 200, nil).Once()

		res, err := gatewayWithBrave.Search(context.Background(), SearchParams{OriginalQuery: "capped", MaxResults: 1})

		require.NoError(t, err)
		require.Len(t, res.Results, 1)
		assert.Equal(t, "brave", res.ProviderLabel)
		assert.Equal(t, "Brave first", res.Results[0].Title)
		mockBrave.AssertExpectations(t)
	})

	t.Run("Search - Brave success ignores PubChem failure", func(t *testing.T) {
		mockBrave := new(MockBraveClient)
		validResp := &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{
				Results: []bravesearch.SearchResult{
					{Title: "Brave only", URL: "url1"},
				},
			},
		}
		mockBrave.On("WebSearch", mock.Anything, "benzene", mock.Anything).Return(validResp, nil).Once()

		gatewayWithBrave := &SearchGateway{
			config:      BraveConfig{APIKey: "key"},
			httpClient:  mockClient,
			braveClient: mockBrave,
		}

		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return(nil, 400, nil).Once()

		params := SearchParams{OriginalQuery: "benzene"}
		res, err := gatewayWithBrave.Search(context.Background(), params)
		require.NoError(t, err)
		assert.Len(t, res.Results, 1)
		assert.Equal(t, "brave", res.ProviderLabel)
		assert.Equal(t, "Brave only", res.Results[0].Title)
	})

	t.Run("Search - Brave failure falls back to PubChem success", func(t *testing.T) {
		mockBrave := new(MockBraveClient)
		mockBrave.On("WebSearch", mock.Anything, "benzene", mock.Anything).Return(nil, errors.New("brave unavailable")).Once()

		gatewayWithBrave := &SearchGateway{
			config:      BraveConfig{APIKey: "key"},
			httpClient:  mockClient,
			braveClient: mockBrave,
		}

		mockClient.On("Get", mock.Anything, mock.Anything, mock.Anything).Return([]byte(`{"InformationList":{"Information":[{"CID":456,"Synonym":["syn1"]}]}}`), 200, nil).Once()

		params := SearchParams{OriginalQuery: "benzene"}
		res, err := gatewayWithBrave.Search(context.Background(), params)

		require.NoError(t, err)
		assert.Len(t, res.Results, 1)
		assert.Equal(t, "pubchem", res.ProviderLabel)
		assert.Equal(t, "PubChem data for benzene", res.Results[0].Title)
		assert.Equal(t, "https://pubchem.ncbi.nlm.nih.gov/compound/456", res.Results[0].URL)
		mockBrave.AssertExpectations(t)
	})
}
