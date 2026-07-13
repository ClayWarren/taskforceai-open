package pkg

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	bravesearch "github.com/claywarren/go-brave-search"
)

type benchmarkHTTPClient struct {
	body     []byte
	delay    time.Duration
	statuses []int
	calls    int
}

func (c *benchmarkHTTPClient) Get(ctx context.Context, requestURL string, headers map[string]string) ([]byte, int, error) {
	if c.delay > 0 {
		time.Sleep(c.delay)
	}
	status := 200
	if c.calls < len(c.statuses) {
		status = c.statuses[c.calls]
	}
	c.calls++
	if status != 200 {
		return nil, status, nil
	}
	return c.body, status, nil
}

func BenchmarkFetchPubChemResultsFirstAttempt(b *testing.B) {
	ctx := context.Background()
	body := []byte(`{"InformationList":{"Information":[{"CID":962,"Synonym":["water","oxidane","dihydrogen monoxide","H2O","aqua","hydrogen oxide"]}]}}`)
	tokens := []string{"water", "H2O", "oxidane"}

	b.ReportAllocs()
	for b.Loop() {
		client := &benchmarkHTTPClient{body: body}
		results, err := FetchPubChemResultsWithUserAgent(ctx, client, "water point group symmetry", tokens, " TaskForceAI Agent ")
		if err != nil {
			b.Fatal(err)
		}
		if len(results) != 1 || !strings.Contains(results[0].Snippet, "H2O") {
			b.Fatalf("unexpected results: %#v", results)
		}
	}
}

func BenchmarkFetchPubChemResultsFallbackAttempts(b *testing.B) {
	ctx := context.Background()
	body := []byte(`{"InformationList":{"Information":[{"CID":962,"Synonym":["water","oxidane","dihydrogen monoxide","H2O","aqua","hydrogen oxide"]}]}}`)
	tokens := []string{"H2O", "oxidane"}

	b.ReportAllocs()
	for b.Loop() {
		client := &benchmarkHTTPClient{
			body:     body,
			statuses: []int{404, 404, 200},
		}
		results, err := FetchPubChemResultsWithUserAgent(ctx, client, "water point group symmetry", tokens, " TaskForceAI Agent ")
		if err != nil {
			b.Fatal(err)
		}
		if len(results) != 1 || client.calls != 3 {
			b.Fatalf("unexpected results/calls: results=%#v calls=%d", results, client.calls)
		}
	}
}

type benchmarkBraveClient struct {
	resp  *bravesearch.WebSearchResponse
	delay time.Duration
}

func (c benchmarkBraveClient) WebSearch(ctx context.Context, query string, params *bravesearch.WebSearchParams) (*bravesearch.WebSearchResponse, error) {
	if c.delay > 0 {
		time.Sleep(c.delay)
	}
	return c.resp, nil
}

func BenchmarkFetchBraveResultsFullPage(b *testing.B) {
	results := make([]bravesearch.SearchResult, 20)
	for i := range results {
		results[i] = bravesearch.SearchResult{
			Title:       fmt.Sprintf("Result %d", i),
			URL:         fmt.Sprintf("https://example.com/%d", i),
			Description: fmt.Sprintf("Description %d", i),
		}
	}
	client := benchmarkBraveClient{
		resp: &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: results},
		},
	}
	ctx := context.Background()

	b.ReportAllocs()
	for b.Loop() {
		items, err := FetchBraveResults(ctx, client, "benchmark query", 20)
		if err != nil {
			b.Fatal(err)
		}
		if len(items) != 20 {
			b.Fatalf("unexpected result count: %d", len(items))
		}
	}
}

func BenchmarkSearchProviderLatencyProfile(b *testing.B) {
	body := []byte(`{"InformationList":{"Information":[{"CID":962,"Synonym":["water","oxidane","dihydrogen monoxide","H2O","aqua","hydrogen oxide"]}]}}`)
	tokens := []string{"water", "H2O", "oxidane"}
	braveResults := make([]bravesearch.SearchResult, 20)
	for i := range braveResults {
		braveResults[i] = bravesearch.SearchResult{
			Title:       fmt.Sprintf("Result %d", i),
			URL:         fmt.Sprintf("https://example.com/%d", i),
			Description: fmt.Sprintf("Description %d", i),
		}
	}
	braveClient := benchmarkBraveClient{
		delay: time.Millisecond,
		resp: &bravesearch.WebSearchResponse{
			Web: &bravesearch.Search{Results: braveResults},
		},
	}

	braveSamples := make([]time.Duration, 0, b.N)
	pubChemSamples := make([]time.Duration, 0, b.N)
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		startedAt := time.Now()
		braveItems, err := FetchBraveResults(ctx, braveClient, "benchmark query", 20)
		braveSamples = append(braveSamples, time.Since(startedAt))
		if err != nil {
			b.Fatal(err)
		}
		if len(braveItems) != 20 {
			b.Fatalf("unexpected brave result count: %d", len(braveItems))
		}

		pubChemClient := &benchmarkHTTPClient{body: body, delay: time.Millisecond}
		startedAt = time.Now()
		pubChemItems, err := FetchPubChemResultsWithUserAgent(ctx, pubChemClient, "water point group symmetry", tokens, "TaskForceAI Agent")
		pubChemSamples = append(pubChemSamples, time.Since(startedAt))
		if err != nil {
			b.Fatal(err)
		}
		if len(pubChemItems) != 1 {
			b.Fatalf("unexpected pubchem result count: %d", len(pubChemItems))
		}
	}
	b.StopTimer()

	reportSearchProviderLatencyProfile(b, "brave", braveSamples)
	reportSearchProviderLatencyProfile(b, "pubchem", pubChemSamples)
}

func reportSearchProviderLatencyProfile(b *testing.B, name string, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		b.Fatalf("no %s latency samples recorded", name)
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(searchProviderDurationMicroseconds(searchProviderPercentileDuration(ordered, 0.50)), name+"_p50_us")
	b.ReportMetric(searchProviderDurationMicroseconds(searchProviderPercentileDuration(ordered, 0.95)), name+"_p95_us")
	b.ReportMetric(searchProviderDurationMicroseconds(searchProviderPercentileDuration(ordered, 0.99)), name+"_p99_us")
}

func searchProviderPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}

func searchProviderDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / float64(time.Microsecond)
}
