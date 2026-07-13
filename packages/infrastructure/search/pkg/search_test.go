package pkg

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"

	bravesearch "github.com/claywarren/go-brave-search"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type MockHttpClient struct {
	mock.Mock
}

func (m *MockHttpClient) Get(ctx context.Context, url string, headers map[string]string) ([]byte, int, error) {
	args := m.Called(ctx, url, headers)
	var body []byte
	if args.Get(0) != nil {
		castBody, ok := args.Get(0).([]byte)
		if !ok {
			return nil, 0, fmt.Errorf("unexpected response body type: %T", args.Get(0))
		}
		body = castBody
	}
	return body, args.Int(1), args.Error(2)
}

type recordingHTTPClient struct {
	calls    []string
	headers  []map[string]string
	response func(call int, url string) ([]byte, int, error)
}

func (c *recordingHTTPClient) Get(ctx context.Context, requestURL string, headers map[string]string) ([]byte, int, error) {
	c.calls = append(c.calls, requestURL)
	c.headers = append(c.headers, headers)
	if c.response == nil {
		return nil, 404, nil
	}
	return c.response(len(c.calls), requestURL)
}

func TestFetchBraveResults(t *testing.T) {
	ctx := context.Background()

	t.Run("Nil client returns error", func(t *testing.T) {
		_, err := FetchBraveResults(ctx, nil, "test query", 1)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not configured")
	})

	// Integration tests with real Brave client require API key
	// and are skipped in unit tests
}

func TestSearchProviderErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("Brave - Nil Client", func(t *testing.T) {
		_, err := FetchBraveResults(ctx, nil, "q", 1)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not configured")
	})
}

func TestMin(t *testing.T) {
	assert.Equal(t, 1, min(1, 2))
	assert.Equal(t, 1, min(2, 1))
}

func TestFetchPubChemResultsWithUserAgent(t *testing.T) {
	mockClient := new(MockHttpClient)
	ctx := context.Background()

	mockResponse := []byte(`{
		"InformationList": {
			"Information": [
				{"CID": 123, "Synonym": ["Syn1", "Syn2"]}
			]
		}
	}`)

	mockClient.On("Get", ctx, mock.Anything, mock.Anything).Return(mockResponse, 200, nil)

	results, err := FetchPubChemResultsWithUserAgent(ctx, mockClient, "water", []string{"H2O"}, "")

	require.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Contains(t, results[0].Title, "PubChem data")
	require.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Contains(t, results[0].Title, "PubChem data")
}

func TestFetchPubChemResults_AttemptFallbacksAndSkipsEmptySynonyms(t *testing.T) {
	ctx := context.Background()
	client := &recordingHTTPClient{
		response: func(call int, requestURL string) ([]byte, int, error) {
			switch call {
			case 1:
				return nil, 404, nil
			case 2:
				return []byte(`{"InformationList":{"Information":[{"CID":456,"Synonym":[]}]}}`), 200, nil
			case 3:
				return []byte(`{"InformationList":{"Information":[{"CID":789,"Synonym":["Water","Oxidane"]}]}}`), 200, nil
			default:
				return nil, 500, nil
			}
		},
	}

	results, err := FetchPubChemResultsWithUserAgent(ctx, client, "water point group symmetry", []string{"H2O"}, "")

	require.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "PubChem data for water point group symmetry", results[0].Title)
	assert.Equal(t, "https://pubchem.ncbi.nlm.nih.gov/compound/789", results[0].URL)
	assert.Len(t, client.calls, 3)
	assertPubChemAttempt(t, client.calls[0], "water")
	assertPubChemAttempt(t, client.calls[1], "H2O")
	assertPubChemAttempt(t, client.calls[2], "water point group symmetry")
}

func TestFetchPubChemResultsWithUserAgentSendsTrimmedHeader(t *testing.T) {
	ctx := context.Background()
	client := &recordingHTTPClient{
		response: func(call int, requestURL string) ([]byte, int, error) {
			return []byte(`{"InformationList":{"Information":[{"Synonym":["Water","Oxidane"]}]}}`), 200, nil
		},
	}

	results, err := FetchPubChemResultsWithUserAgent(ctx, client, "water", nil, " TaskForceAI Agent ")

	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "https://pubchem.ncbi.nlm.nih.gov/", results[0].URL)
	require.Len(t, client.headers, 1)
	assert.Equal(t, map[string]string{"User-Agent": "TaskForceAI Agent"}, client.headers[0])
}

func TestFetchPubChemResultsWithUserAgentDropsOversizedHeader(t *testing.T) {
	ctx := context.Background()
	client := &recordingHTTPClient{
		response: func(call int, requestURL string) ([]byte, int, error) {
			return []byte(`{"InformationList":{"Information":[{"Synonym":["Water","Oxidane"]}]}}`), 200, nil
		},
	}

	results, err := FetchPubChemResultsWithUserAgent(ctx, client, "water", nil, strings.Repeat("a", maxSearchUserAgentBytes+1))

	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Len(t, client.headers, 1)
	assert.Nil(t, client.headers[0])
}

func assertPubChemAttempt(t *testing.T, requestURL string, expectedAttempt string) {
	t.Helper()

	parsed, err := url.Parse(requestURL)
	require.NoError(t, err)
	path := parsed.EscapedPath()
	prefix := "/rest/pug/compound/name/"
	suffix := "/synonyms/JSON"
	if !assert.True(t, strings.HasPrefix(path, prefix) && strings.HasSuffix(path, suffix), "unexpected PubChem URL path: %s", path) {
		return
	}

	escapedAttempt := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	attempt, err := url.PathUnescape(escapedAttempt)
	require.NoError(t, err)
	assert.Equal(t, expectedAttempt, attempt)
}

// --- Brave Search Tests ---

type MockBraveClient struct {
	mock.Mock
}

func (m *MockBraveClient) WebSearch(ctx context.Context, query string, params *bravesearch.WebSearchParams) (*bravesearch.WebSearchResponse, error) {
	args := m.Called(ctx, query, params)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	response, ok := args.Get(0).(*bravesearch.WebSearchResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected web search response type: %T", args.Get(0))
	}
	return response, args.Error(1)
}

func TestFetchBraveResults_Unit(t *testing.T) {
	ctx := context.Background()

	t.Run("nil client", func(t *testing.T) {
		res, err := FetchBraveResults(ctx, nil, "query", 5)
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "client is not configured")
	})

	t.Run("api error", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		mockClient.On("WebSearch", ctx, "error_query", mock.Anything).Return(nil, errors.New("api error"))

		res, err := FetchBraveResults(ctx, mockClient, "error_query", 5)
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "brave search failed")
	})

	t.Run("no results", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		emptyResp := &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{
				Results: []bravesearch.SearchResult{},
			},
		}
		mockClient.On("WebSearch", ctx, "empty", mock.Anything).Return(emptyResp, nil)

		res, err := FetchBraveResults(ctx, mockClient, "empty", 5)
		require.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("nil web payload", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		mockClient.On("WebSearch", ctx, "nil-web", mock.Anything).Return(&bravesearch.WebSearchResponse{}, nil)

		res, err := FetchBraveResults(ctx, mockClient, "nil-web", 5)

		require.NoError(t, err)
		assert.Empty(t, res)
	})

	t.Run("success", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		validResp := &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{
				Results: []bravesearch.SearchResult{
					{Title: "Result 1", URL: "https://example.com/1", Description: "Desc 1"},
					{Title: "", URL: "https://example.com/2", Description: "Desc 2"}, // Test fallback title
				},
			},
		}
		mockClient.On("WebSearch", ctx, "success", mock.Anything).Return(validResp, nil)

		res, err := FetchBraveResults(ctx, mockClient, "success", 5)
		require.NoError(t, err)
		assert.Len(t, res, 2)
		assert.Equal(t, "Result 1", res[0].Title)
		assert.Equal(t, "https://example.com/2", res[1].Title) // fallback
	})

	t.Run("deduplicates URLs", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		validResp := &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{
				Results: []bravesearch.SearchResult{
					{Title: "First", URL: "https://example.com/repeated", Description: "First desc"},
					{Title: "Duplicate", URL: "https://example.com/repeated", Description: "Duplicate desc"},
					{Title: "Second", URL: "https://example.com/second", Description: "Second desc"},
				},
			},
		}
		mockClient.On("WebSearch", ctx, "dedupe", mock.Anything).Return(validResp, nil)

		res, err := FetchBraveResults(ctx, mockClient, "dedupe", 5)

		require.NoError(t, err)
		require.Len(t, res, 2)
		assert.Equal(t, "First", res[0].Title)
		assert.Equal(t, "Second", res[1].Title)
	})

	t.Run("caps deeper requests to one provider page", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		firstPage := make([]bravesearch.SearchResult, 0, 20)
		for i := 1; i <= 20; i++ {
			firstPage = append(firstPage, bravesearch.SearchResult{
				Title:       fmt.Sprintf("Result %d", i),
				URL:         fmt.Sprintf("https://example.com/%d", i),
				Description: fmt.Sprintf("Desc %d", i),
			})
		}

		mockClient.On(
			"WebSearch",
			ctx,
			"deep",
			mock.MatchedBy(func(params *bravesearch.WebSearchParams) bool {
				return params.Count == 20 && params.Offset == 0
			}),
		).Return(&bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: firstPage},
		}, nil).Once()

		res, err := FetchBraveResults(ctx, mockClient, "deep", 25)

		require.NoError(t, err)
		assert.Len(t, res, 20)
		assert.Equal(t, "https://example.com/1", res[0].URL)
		assert.Equal(t, "https://example.com/20", res[19].URL)
		mockClient.AssertExpectations(t)
	})

	t.Run("returns partial results when later page errors", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		firstPage := make([]bravesearch.SearchResult, 0, 20)
		for i := 1; i <= 20; i++ {
			firstPage = append(firstPage, bravesearch.SearchResult{
				Title:       fmt.Sprintf("Result %d", i),
				URL:         fmt.Sprintf("https://example.com/%d", i),
				Description: fmt.Sprintf("Desc %d", i),
			})
		}

		mockClient.On("WebSearch", ctx, "partial-error", mock.MatchedBy(func(params *bravesearch.WebSearchParams) bool {
			return params.Count == 20 && params.Offset == 0
		})).Return(&bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: firstPage},
		}, nil).Once()
		mockClient.On("WebSearch", ctx, "partial-error", mock.MatchedBy(func(params *bravesearch.WebSearchParams) bool {
			return params.Count == 20 && params.Offset == 1
		})).Return(nil, errors.New("page failed")).Once()
		res, err := fetchBraveResults(ctx, mockClient, "partial-error", 25, 1)

		require.NoError(t, err)
		assert.Len(t, res, 20)
		assert.Equal(t, "https://example.com/20", res[19].URL)
		mockClient.AssertExpectations(t)
	})

	t.Run("returns partial results when later page is empty", func(t *testing.T) {
		mockClient := new(MockBraveClient)
		firstPage := make([]bravesearch.SearchResult, 0, 20)
		for i := 1; i <= 20; i++ {
			firstPage = append(firstPage, bravesearch.SearchResult{
				Title:       fmt.Sprintf("Result %d", i),
				URL:         fmt.Sprintf("https://example.com/%d", i),
				Description: fmt.Sprintf("Desc %d", i),
			})
		}

		mockClient.On("WebSearch", ctx, "partial-empty", mock.MatchedBy(func(params *bravesearch.WebSearchParams) bool {
			return params.Count == 20 && params.Offset == 0
		})).Return(&bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: firstPage},
		}, nil).Once()
		mockClient.On("WebSearch", ctx, "partial-empty", mock.MatchedBy(func(params *bravesearch.WebSearchParams) bool {
			return params.Count == 20 && params.Offset == 1
		})).Return(&bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: []bravesearch.SearchResult{}},
		}, nil).Once()
		res, err := fetchBraveResults(ctx, mockClient, "partial-empty", 25, 1)

		require.NoError(t, err)
		assert.Len(t, res, 20)
		assert.Equal(t, "https://example.com/20", res[19].URL)
		mockClient.AssertExpectations(t)
	})
}
