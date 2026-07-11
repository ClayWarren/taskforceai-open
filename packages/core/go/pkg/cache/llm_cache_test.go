package cache

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

type MockCache struct {
	data map[string]string
	ttls map[string]time.Duration
}

func NewMockCache() *MockCache {
	return &MockCache{data: make(map[string]string), ttls: make(map[string]time.Duration)}
}

func (m *MockCache) Get(ctx context.Context, key string) (string, error) {
	val, ok := m.data[key]
	if !ok {
		return "", fmt.Errorf("not found")
	}
	return val, nil
}

func (m *MockCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	m.data[key] = value
	m.ttls[key] = ttl
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
	m.ttls = make(map[string]time.Duration)
	return nil
}

type failingSetCache struct {
	*MockCache
	setErr error
}

func (m *failingSetCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	if m.setErr != nil {
		return m.setErr
	}
	return m.MockCache.Set(ctx, key, value, ttl)
}

type invalidJSONCache struct {
	*MockCache
}

func (c *invalidJSONCache) Get(ctx context.Context, key string) (string, error) {
	if key != "" {
		return "not-json", nil
	}
	return c.MockCache.Get(ctx, key)
}

func TestLLMCache(t *testing.T) {
	mock := NewMockCache()
	llmCache := NewLLMCache(mock)
	ctx := context.Background()

	t.Run("Agent Response Cache", func(t *testing.T) {
		ns := "test-ns"
		query := "What is 2+2?"
		prompt := "You are a math tutor"
		response := "It is 4"

		// Set
		err := llmCache.SetCachedAgentResponse(ctx, ns, query, prompt, response)
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}

		// Get
		res := llmCache.GetCachedAgentResponse(ctx, ns, query, prompt)
		if !res.Ok {
			t.Errorf("expected success, got error %v", res.Error)
		}
		if res.Value != response {
			t.Errorf("expected %q, got %q", response, res.Value)
		}

		// Get with different query (normalized)
		res2 := llmCache.GetCachedAgentResponse(ctx, ns, "What is 2+2", prompt)
		if !res2.Ok {
			t.Errorf("expected success for normalized query, got %v", res2.Error)
		}
	})

	t.Run("Synthesis Cache", func(t *testing.T) {
		ns := "test-ns"
		results := []string{"res1", "res2"}
		synthesis := "Combined result"

		err := llmCache.SetCachedSynthesis(ctx, ns, results, synthesis)
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}

		res := llmCache.GetCachedSynthesis(ctx, ns, results)
		if !res.Ok {
			t.Errorf("expected success, got %v", res.Error)
		}
		if res.Value != synthesis {
			t.Errorf("expected %q, got %q", synthesis, res.Value)
		}
	})

	t.Run("Decomposition Cache", func(t *testing.T) {
		ns := "test-ns"
		query := "Plan a trip"
		subtasks := []string{"book flight", "book hotel"}

		err := llmCache.SetCachedDecomposition(ctx, ns, query, subtasks)
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}

		res := llmCache.GetCachedDecomposition(ctx, ns, query)
		if !res.Ok {
			t.Errorf("expected success, got %v", res.Error)
		}
		if len(res.Value) != 2 || res.Value[0] != "book flight" {
			t.Errorf("unexpected decomposition result: %v", res.Value)
		}
	})

	t.Run("Cache Writes Use Expiring TTL", func(t *testing.T) {
		if len(mock.ttls) == 0 {
			t.Fatal("expected cache writes to be recorded")
		}
		for key, ttl := range mock.ttls {
			if ttl != defaultLLMCacheTTL {
				t.Fatalf("expected default LLM cache TTL for %s, got %v", key, ttl)
			}
		}
	})

	t.Run("Invalid Namespace", func(t *testing.T) {
		err := llmCache.SetCachedAgentResponse(ctx, "  ", "q", "p", "r")
		if err == nil {
			t.Errorf("expected error for empty namespace")
		}
	})

	t.Run("Decomposition Cache - Corrupted Data", func(t *testing.T) {
		ns := "test-ns"
		query := "Plan a trip"
		// Manually inject invalid JSON
		key := fmt.Sprintf("decompose:%s", HashKey(fmt.Sprintf("%s:%s", ns, NormalizeQuery(query))))
		mock.data[key] = "{invalid-json"

		res := llmCache.GetCachedDecomposition(ctx, ns, query)
		if res.Ok {
			t.Errorf("expected error for corrupted data, got success")
		}
	})

	t.Run("GetCachedAgentResponse - Cache Error", func(t *testing.T) {
		failingCache := &FailingMockCache{MockCache: NewMockCache()}
		l := NewLLMCache(failingCache)

		res := l.GetCachedAgentResponse(ctx, "ns", "q", "p")
		if res.Ok {
			t.Errorf("expected error from failing cache")
		}
	})

	t.Run("GetCachedDecomposition - Cache Error", func(t *testing.T) {
		failingCache := &FailingMockCache{MockCache: NewMockCache()}
		l := NewLLMCache(failingCache)

		res := l.GetCachedDecomposition(ctx, "ns", "q")
		if res.Ok {
			t.Errorf("expected error from failing cache")
		}
	})

	t.Run("GetCachedSynthesis - Cache Error", func(t *testing.T) {
		failingCache := &FailingMockCache{MockCache: NewMockCache()}
		l := NewLLMCache(failingCache)

		res := l.GetCachedSynthesis(ctx, "ns", []string{"r"})
		if res.Ok {
			t.Errorf("expected error from failing cache")
		}
	})
}

type FailingMockCache struct {
	*MockCache
}

func (m *FailingMockCache) Get(ctx context.Context, key string) (string, error) {
	return "", fmt.Errorf("db error")
}

func TestLLMCacheCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("invalid namespace get and set paths", func(t *testing.T) {
		llmCache := NewLLMCache(NewMockCache())
		if res := llmCache.GetCachedAgentResponse(ctx, " ", "q", "p"); res.Ok {
			t.Fatal("expected invalid namespace for agent response get")
		}
		if res := llmCache.GetCachedSynthesis(ctx, " ", []string{"a"}); res.Ok {
			t.Fatal("expected invalid namespace for synthesis get")
		}
		if res := llmCache.GetCachedDecomposition(ctx, "", "q"); res.Ok {
			t.Fatal("expected invalid namespace for decomposition get")
		}
		if err := llmCache.SetCachedSynthesis(ctx, " ", []string{"a"}, "s"); err == nil {
			t.Fatal("expected invalid namespace for synthesis set")
		}
		if err := llmCache.SetCachedDecomposition(ctx, " ", "q", []string{"a"}); err == nil {
			t.Fatal("expected invalid namespace for decomposition set")
		}
	})

	t.Run("set cached agent response propagates cache errors", func(t *testing.T) {
		cache := &failingSetCache{MockCache: NewMockCache(), setErr: errors.New("set failed")}
		llmCache := NewLLMCache(cache)
		if err := llmCache.SetCachedAgentResponse(ctx, "ns", "q", "p", "r"); err == nil {
			t.Fatal("expected set failure")
		}
	})

	t.Run("nil cached decomposition becomes empty slice", func(t *testing.T) {
		cache := NewMockCache()
		llmCache := NewLLMCache(cache)
		key := fmt.Sprintf("decompose:%s", HashKey(fmt.Sprintf("%s:%s", "ns", NormalizeQuery("query"))))
		cache.data[key] = "null"

		res := llmCache.GetCachedDecomposition(ctx, "ns", "query")
		if !res.Ok {
			t.Fatalf("expected successful cached decomposition, got %v", res.Error)
		}
		if len(res.Value) != 0 {
			t.Fatalf("expected empty decomposition slice, got %#v", res.Value)
		}
	})
}

func TestLLMCachePushTo95CoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("get cached decomposition rejects invalid json payloads", func(t *testing.T) {
		llmCache := NewLLMCache(&invalidJSONCache{MockCache: NewMockCache()})
		if err := llmCache.SetCachedDecomposition(ctx, "ns", "query", []string{"a"}); err != nil {
			t.Fatalf("set cached decomposition: %v", err)
		}
		res := llmCache.GetCachedDecomposition(ctx, "ns", "query")
		if res.Ok {
			t.Fatal("expected invalid json cache payload to fail")
		}
	})

	t.Run("get cached agent response propagates cache get errors", func(t *testing.T) {
		llmCache := NewLLMCache(&failingSetCache{MockCache: NewMockCache(), setErr: errors.New("unused")})
		res := llmCache.GetCachedAgentResponse(ctx, "ns", "query", "prompt")
		if res.Ok {
			t.Fatal("expected cache miss error")
		}
	})
}

func TestNormalizeQuery(t *testing.T) {
	input := "Hello, World! How are you?"
	expected := "hello world how are you"
	got := NormalizeQuery(input)
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}
