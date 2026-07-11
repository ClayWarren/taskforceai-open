package tools

import (
	"context"
	"fmt"
	"time"
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

type MockCache struct {
	data map[string]string
}

func (m *MockCache) Get(ctx context.Context, key string) (string, error) {
	val, ok := m.data[key]
	if !ok {
		return "", fmt.Errorf("not found")
	}
	return val, nil
}

func (m *MockCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	if m.data == nil {
		m.data = make(map[string]string)
	}
	m.data[key] = value
	return nil
}

func (m *MockCache) Delete(ctx context.Context, key string) (bool, error) {
	_, ok := m.data[key]
	delete(m.data, key)
	return ok, nil
}

func (m *MockCache) Take(ctx context.Context, key string) (string, error) {
	val, err := m.Get(ctx, key)
	if err == nil {
		_, _ = m.Delete(ctx, key)
	}
	return val, err
}

func (m *MockCache) Clear(ctx context.Context) error {
	m.data = make(map[string]string)
	return nil
}
