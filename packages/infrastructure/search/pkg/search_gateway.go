package pkg

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/retry"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	bravesearch "github.com/claywarren/go-brave-search"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var (
	braveCircuitBreakerOnce sync.Once
	braveCircuitBreaker     *circuitbreaker.CircuitBreaker

	pubChemCircuitBreakerOnce sync.Once
	pubChemCircuitBreaker     *circuitbreaker.CircuitBreaker

	newBraveSearcher = newBraveClient
)

func getBraveCircuitBreaker() *circuitbreaker.CircuitBreaker {
	braveCircuitBreakerOnce.Do(func() {
		braveCircuitBreaker = newSearchCircuitBreaker("brave_search")
	})
	return braveCircuitBreaker
}

func getPubChemCircuitBreaker() *circuitbreaker.CircuitBreaker {
	pubChemCircuitBreakerOnce.Do(func() {
		pubChemCircuitBreaker = newSearchCircuitBreaker("pubchem_search")
	})
	return pubChemCircuitBreaker
}

func newSearchCircuitBreaker(name string) *circuitbreaker.CircuitBreaker {
	return upstream.NewCircuitBreaker(name, 30*time.Second, isSearchRetryableError)
}

func isSearchRetryableError(err error) bool {
	return upstream.IsTransientError(err)
}

//

type SearchGateway struct {
	config             BraveConfig
	httpClient         IHttpClient
	braveClient        BraveSearcher
	braveClientFactory func(userAgent string) (BraveSearcher, error)
	braveClients       map[string]BraveSearcher
	braveClientsMu     sync.Mutex
}

const (
	maxSearchUserAgentBytes  = 256
	maxCachedBraveUserAgents = 16
)

func NewSearchGateway(config BraveConfig) (*SearchGateway, error) {
	var braveClient BraveSearcher
	if config.APIKey != "" {
		var err error
		braveClient, err = newBraveSearcher(config, config.UserAgent)
		if err != nil {
			return nil, err
		}
		slog.Info("[SearchGateway] Initialized with API key")
	} else {
		slog.Warn("[SearchGateway] Initialized WITHOUT API key - Brave search will be disabled")
	}
	return &SearchGateway{
		config:      config,
		httpClient:  NewDefaultHttpClient(10 * time.Second),
		braveClient: braveClient,
		braveClientFactory: func(userAgent string) (BraveSearcher, error) {
			return newBraveSearcher(config, userAgent)
		},
		braveClients: map[string]BraveSearcher{
			strings.TrimSpace(config.UserAgent): braveClient,
		},
	}, nil
}

func braveBaseURLFromEndpoint(endpoint string) string {
	return strings.TrimSuffix(endpoint, "/web/search")
}

func newBraveClient(config BraveConfig, userAgent string) (BraveSearcher, error) {
	options := []bravesearch.ClientOption{}
	if config.Endpoint != "" {
		options = append(options, bravesearch.WithBaseURL(braveBaseURLFromEndpoint(config.Endpoint)))
	}
	if strings.TrimSpace(userAgent) != "" {
		options = append(options, bravesearch.WithUserAgent(userAgent))
	}
	options = append(options, bravesearch.WithRetries(0))
	return bravesearch.NewClient(config.APIKey, options...)
}

func effectiveSearchQuery(params SearchParams) string {
	if strings.TrimSpace(params.EffectiveQuery) != "" {
		return params.EffectiveQuery
	}
	return params.OriginalQuery
}

func searchTelemetryAttributes(params SearchParams, effectiveQuery string) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.Int("search.original_query_length", len(params.OriginalQuery)),
		attribute.Int("search.effective_query_length", len(effectiveQuery)),
		attribute.Bool("search.query_rewritten", effectiveQuery != params.OriginalQuery),
		attribute.Int("search.max_results", params.MaxResults),
	}
}

func (g *SearchGateway) effectiveUserAgent(userAgent string) string {
	userAgent = strings.TrimSpace(userAgent)
	if userAgent == "" || len(userAgent) > maxSearchUserAgentBytes {
		userAgent = strings.TrimSpace(g.config.UserAgent)
	}
	if len(userAgent) > maxSearchUserAgentBytes {
		return ""
	}
	return userAgent
}

func (g *SearchGateway) braveSearcherFor(userAgent string) (BraveSearcher, error) {
	if strings.TrimSpace(g.config.APIKey) == "" {
		return nil, nil
	}
	userAgent = g.effectiveUserAgent(userAgent)
	if g.braveClientFactory == nil || g.braveClients == nil {
		return g.braveClient, nil
	}

	g.braveClientsMu.Lock()
	defer g.braveClientsMu.Unlock()

	if client, ok := g.braveClients[userAgent]; ok {
		return client, nil
	}
	if len(g.braveClients) >= maxCachedBraveUserAgents {
		return g.braveClient, nil
	}
	client, err := g.braveClientFactory(userAgent)
	if err != nil {
		return nil, err
	}
	g.braveClients[userAgent] = client
	return client, nil
}

func (g *SearchGateway) Search(ctx context.Context, params SearchParams) (*SearchGatewayResult, error) {
	braveQuery := effectiveSearchQuery(params)
	ctx, span := tracer.Start(ctx, "search.gateway.search", trace.WithAttributes(searchTelemetryAttributes(params, braveQuery)...))
	defer span.End()

	slog.Info("[SearchGateway] Starting search", "maxResults", params.MaxResults)
	var combinedResults []SearchResultItem
	var providerErrors []error
	var braveContributed bool
	var pubChemContributed bool

	braveClient, err := g.braveSearcherFor(params.UserAgent)
	switch {
	case err != nil:
		slog.Error("[SearchGateway] Brave client initialization failed", "error", err)
		providerErrors = append(providerErrors, fmt.Errorf("brave search: %w", err))
	case braveClient == nil:
		slog.Warn("[SearchGateway] Brave client is nil - API key may not be configured, skipping Brave search")
		providerErrors = append(providerErrors, fmt.Errorf("brave search: brave search client is not configured"))
	default:
		breaker := getBraveCircuitBreaker()
		err := breaker.Execute(ctx, func() error {
			return retry.Do(ctx, retry.Config{
				MaxAttempts:     2,
				InitialInterval: 200 * time.Millisecond,
				MaxInterval:     1 * time.Second,
				Multiplier:      2.0,
				Retryable:       isSearchRetryableError,
			}, func(retryCtx context.Context) error {
				braveResults, err := FetchBraveResults(retryCtx, braveClient, braveQuery, params.MaxResults)
				if err != nil {
					return err
				}
				slog.Info("[SearchGateway] Brave search succeeded", "count", len(braveResults))
				combinedResults, braveContributed = appendSearchResults(combinedResults, braveResults, params.MaxResults)
				return nil
			})
		})

		if err != nil {
			slog.Error("[SearchGateway] Brave search failed (with resilience)", "error", err)
			providerErrors = append(providerErrors, fmt.Errorf("brave search: %w", err))
		}
	}

	// PubChem is a chemistry supplement; skip it for queries with no chemistry
	// signal so every search does not pay an NCBI round-trip.
	if isChemistryRelevant(params.OriginalQuery) {
		breaker := getPubChemCircuitBreaker()
		pubChemErr := breaker.Execute(ctx, func() error {
			return retry.Do(ctx, retry.Config{
				MaxAttempts:     2,
				InitialInterval: 200 * time.Millisecond,
				MaxInterval:     1 * time.Second,
				Multiplier:      2.0,
				Retryable:       isSearchRetryableError,
			}, func(retryCtx context.Context) error {
				pubChemResults, err := FetchPubChemResultsWithUserAgent(retryCtx, g.httpClient, params.OriginalQuery, params.Tokens, g.effectiveUserAgent(params.UserAgent))
				if err != nil {
					return err
				}
				if len(pubChemResults) > 0 {
					slog.Info("[SearchGateway] PubChem results found", "count", len(pubChemResults))
					combinedResults, pubChemContributed = appendSearchResults(combinedResults, pubChemResults, params.MaxResults)
				}
				return nil
			})
		})

		if pubChemErr != nil {
			slog.Error("[SearchGateway] PubChem search failed (with resilience)", "error", pubChemErr)
			providerErrors = append(providerErrors, fmt.Errorf("pubchem search: %w", pubChemErr))
		}
	}

	if len(combinedResults) == 0 && len(providerErrors) > 0 {
		err := errors.Join(providerErrors...)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	span.SetAttributes(attribute.Int("search.result_count", len(combinedResults)))
	return &SearchGatewayResult{
		Results:       combinedResults,
		ProviderLabel: searchProviderLabel(braveContributed, pubChemContributed),
	}, nil
}

func searchProviderLabel(braveContributed, pubChemContributed bool) string {
	switch {
	case braveContributed && pubChemContributed:
		return "brave,pubchem"
	case braveContributed:
		return "brave"
	case pubChemContributed:
		return "pubchem"
	default:
		return ""
	}
}

func appendSearchResults(existing []SearchResultItem, incoming []SearchResultItem, maxResults int) ([]SearchResultItem, bool) {
	if len(incoming) == 0 {
		return existing, false
	}
	if maxResults > 0 {
		remaining := maxResults - len(existing)
		if remaining <= 0 {
			return existing, false
		}
		if len(incoming) > remaining {
			incoming = incoming[:remaining]
		}
	}
	return append(existing, incoming...), true
}
