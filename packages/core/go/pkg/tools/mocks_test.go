package tools

import (
	"context"

	"github.com/TaskForceAI/core/internal/testsupport"
)

type MockSearchGateway struct {
	results []SearchResultItem
	err     error
	params  []SearchParams
}

func (m *MockSearchGateway) Search(ctx context.Context, params SearchParams) (*SearchGatewayResult, error) {
	m.params = append(m.params, params)
	if m.err != nil {
		return nil, m.err
	}
	return &SearchGatewayResult{
		Results:       m.results,
		ProviderLabel: "mock",
	}, nil
}

type MockCache = testsupport.MemoryCache
