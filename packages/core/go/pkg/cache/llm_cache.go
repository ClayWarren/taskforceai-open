package cache

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/shared"
)

const (
	CacheVersion       = "v1"
	defaultLLMCacheTTL = 24 * time.Hour
)

func HashKey(input string) string {
	versioned := fmt.Sprintf("%s:%s", CacheVersion, strings.TrimSpace(strings.ToLower(input)))
	h := sha256.New()
	h.Write([]byte(versioned))
	hash := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	return hash
}

func NormalizeNamespace(ns string) shared.Result[string] {
	t := strings.TrimSpace(strings.ToLower(ns))
	if t == "" {
		return shared.Err[string](fmt.Errorf("INVALID_NAMESPACE"))
	}
	return shared.Ok(t)
}

func NormalizeQuery(q string) string {
	q = strings.ToLower(q)
	replacer := strings.NewReplacer("?", " ", "!", " ", ".", " ", ",", " ", ";", " ", ":", " ")
	q = replacer.Replace(q)
	fields := strings.Fields(q)
	return strings.Join(fields, " ")
}

type LLMCache struct {
	cache ICache
}

func NewLLMCache(cache ICache) *LLMCache {
	return &LLMCache{cache: cache}
}

func (l *LLMCache) GetCachedAgentResponse(ctx context.Context, ns string, query string, systemPrompt string) shared.Result[string] {
	t := NormalizeNamespace(ns)
	if !t.Ok {
		return shared.Err[string](t.Error)
	}

	nsHash := HashKey(fmt.Sprintf("%s:%s", t.Value, systemPrompt))
	if len(nsHash) > 8 {
		nsHash = nsHash[:8]
	}

	normQuery := NormalizeQuery(query)
	key := fmt.Sprintf("agent:%s:%s", nsHash, HashKey(fmt.Sprintf("%s:%s", t.Value, normQuery)))

	val, err := l.cache.Get(ctx, key)
	if err != nil {
		return shared.Err[string](err)
	}
	return shared.Ok(val)
}

func (l *LLMCache) SetCachedAgentResponse(ctx context.Context, ns string, query string, systemPrompt string, response string) error {
	t := NormalizeNamespace(ns)
	if !t.Ok {
		return t.Error
	}

	nsHash := HashKey(fmt.Sprintf("%s:%s", t.Value, systemPrompt))
	if len(nsHash) > 8 {
		nsHash = nsHash[:8]
	}

	normQuery := NormalizeQuery(query)
	key := fmt.Sprintf("agent:%s:%s", nsHash, HashKey(fmt.Sprintf("%s:%s", t.Value, normQuery)))

	return l.cache.Set(ctx, key, response, defaultLLMCacheTTL)
}

func (l *LLMCache) GetCachedSynthesis(ctx context.Context, ns string, results []string) shared.Result[string] {
	t := NormalizeNamespace(ns)
	if !t.Ok {
		return shared.Err[string](t.Error)
	}

	normResults := make([]string, len(results))
	for i, r := range results {
		normResults[i] = NormalizeQuery(r)
	}
	sort.Strings(normResults)

	input := fmt.Sprintf("%s:%s", t.Value, strings.Join(normResults, "|||"))
	key := fmt.Sprintf("synthesis:%s", HashKey(input))

	val, err := l.cache.Get(ctx, key)
	if err != nil {
		return shared.Err[string](err)
	}
	return shared.Ok(val)
}

func (l *LLMCache) SetCachedSynthesis(ctx context.Context, ns string, results []string, synthesis string) error {
	t := NormalizeNamespace(ns)
	if !t.Ok {
		return t.Error
	}

	normResults := make([]string, len(results))
	for i, r := range results {
		normResults[i] = NormalizeQuery(r)
	}
	sort.Strings(normResults)

	input := fmt.Sprintf("%s:%s", t.Value, strings.Join(normResults, "|||"))
	key := fmt.Sprintf("synthesis:%s", HashKey(input))

	return l.cache.Set(ctx, key, synthesis, defaultLLMCacheTTL)
}

func (l *LLMCache) GetCachedDecomposition(ctx context.Context, ns string, query string) shared.Result[[]string] {
	t := NormalizeNamespace(ns)
	if !t.Ok {
		return shared.Err[[]string](t.Error)
	}

	key := fmt.Sprintf("decompose:%s", HashKey(fmt.Sprintf("%s:%s", t.Value, NormalizeQuery(query))))

	val, err := l.cache.Get(ctx, key)
	if err != nil {
		return shared.Err[[]string](err)
	}

	var results []string
	if err := json.Unmarshal([]byte(val), &results); err != nil {
		return shared.Err[[]string](err)
	}
	if results == nil {
		results = []string{}
	}
	return shared.Ok(results)
}

func (l *LLMCache) SetCachedDecomposition(ctx context.Context, ns string, query string, subtasks []string) error {
	t := NormalizeNamespace(ns)
	if !t.Ok {
		return t.Error
	}

	key := fmt.Sprintf("decompose:%s", HashKey(fmt.Sprintf("%s:%s", t.Value, NormalizeQuery(query))))

	val, _ := json.Marshal(subtasks) //nolint:errchkjson // A string slice is always JSON-encodable.
	return l.cache.Set(ctx, key, string(val), defaultLLMCacheTTL)
}
