package testsupport

import (
	"context"
	"fmt"
	"time"
)

// MemoryCache is an in-memory cache adapter for core tests.
type MemoryCache struct {
	Data map[string]string
}

func (m *MemoryCache) Get(_ context.Context, key string) (string, error) {
	value, ok := m.Data[key]
	if !ok {
		return "", fmt.Errorf("not found")
	}
	return value, nil
}

func (m *MemoryCache) Set(_ context.Context, key string, value string, _ time.Duration) error {
	if m.Data == nil {
		m.Data = make(map[string]string)
	}
	m.Data[key] = value
	return nil
}

func (m *MemoryCache) Delete(_ context.Context, key string) (bool, error) {
	_, ok := m.Data[key]
	delete(m.Data, key)
	return ok, nil
}

func (m *MemoryCache) Take(ctx context.Context, key string) (string, error) {
	value, err := m.Get(ctx, key)
	if err == nil {
		_, _ = m.Delete(ctx, key)
	}
	return value, err
}

func (m *MemoryCache) Clear(context.Context) error {
	m.Data = make(map[string]string)
	return nil
}
