package redis

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// ErrKeyNotFound is returned when a key is not found in the mock
var ErrKeyNotFound = errors.New("key not found")

// ErrValueNotInteger is returned when incrementing a non-integer value.
var ErrValueNotInteger = errors.New("value is not an integer or out of range")

// MockClient is an in-memory implementation of Cmdable for testing
type MockClient struct {
	mu         sync.RWMutex
	data       map[string]string
	expires    map[string]time.Time
	rateLimits map[string][]time.Time
}

func NewMockClient() *MockClient {
	return &MockClient{
		data:       make(map[string]string),
		expires:    make(map[string]time.Time),
		rateLimits: make(map[string][]time.Time),
	}
}

func (m *MockClient) SupportsEval() bool {
	return false
}

func (m *MockClient) purgeExpiredLocked(key string) {
	expiresAt, ok := m.expires[key]
	if !ok || time.Now().Before(expiresAt) {
		return
	}
	delete(m.data, key)
	delete(m.expires, key)
}

func (m *MockClient) Get(ctx context.Context, key string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)
	val, ok := m.data[key]
	if !ok {
		return "", ErrKeyNotFound
	}
	return val, nil
}

func (m *MockClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = string(value)
	if ttl > 0 {
		m.expires[key] = time.Now().Add(ttl)
	} else {
		delete(m.expires, key)
	}
	return nil
}

func (m *MockClient) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)
	if _, ok := m.data[key]; ok {
		return false, nil
	}
	m.data[key] = string(value)
	if ttl > 0 {
		m.expires[key] = time.Now().Add(ttl)
	}
	return true, nil
}

func (m *MockClient) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)
	if ttl <= 0 {
		return false, errors.New("expire ttl must be positive")
	}
	if _, ok := m.data[key]; !ok {
		return false, nil
	}
	m.expires[key] = time.Now().Add(ttl)
	return true, nil
}

func (m *MockClient) TTL(ctx context.Context, key string) (time.Duration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)
	if _, ok := m.data[key]; !ok {
		return -2 * time.Nanosecond, nil
	}
	expiresAt, ok := m.expires[key]
	if !ok {
		return -1 * time.Nanosecond, nil
	}
	return time.Until(expiresAt), nil
}

func (m *MockClient) Incr(ctx context.Context, key string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)

	val, ok := m.data[key]
	var num int
	if ok {
		var err error
		num, err = strconv.Atoi(val)
		if err != nil {
			return 0, ErrValueNotInteger
		}
	}
	num++
	m.data[key] = strconv.Itoa(num)
	return num, nil
}

func (m *MockClient) IncrWithExpire(ctx context.Context, key string, ttl time.Duration) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)

	if ttl <= 0 {
		return 0, errors.New("incr with expire ttl must be positive")
	}

	val, ok := m.data[key]
	var num int
	if ok {
		var err error
		num, err = strconv.Atoi(val)
		if err != nil {
			return 0, ErrValueNotInteger
		}
	}
	num++
	m.data[key] = strconv.Itoa(num)
	if num == 1 {
		m.expires[key] = time.Now().Add(ttl)
	}
	return num, nil
}

func (m *MockClient) CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	allowed, remaining, reset := m.checkRateLimitLocked(key, limit, window, true)
	return allowed, remaining, reset, nil
}

func (m *MockClient) checkRateLimitLocked(key string, limit int, window time.Duration, consume bool) (bool, int, time.Time) {
	if m.rateLimits == nil {
		m.rateLimits = make(map[string][]time.Time)
	}

	now := time.Now()
	cutoff := now.Add(-window)
	entries := m.rateLimits[key]
	start := sort.Search(len(entries), func(i int) bool {
		return entries[i].After(cutoff)
	})
	if start > 0 {
		trimmed := make([]time.Time, 0, len(entries)-start)
		for i := start; i < len(entries); i++ {
			trimmed = append(trimmed, entries[i])
		}
		entries = trimmed
	}
	if len(entries) < limit {
		if consume {
			entries = append(entries, now)
		}
		m.rateLimits[key] = entries
		remaining := limit - len(entries)
		return true, max(remaining, 0), now.Add(window)
	}

	m.rateLimits[key] = entries
	reset := now.Add(window)
	if len(entries) > 0 {
		reset = entries[0].Add(window)
	}
	return false, 0, reset
}

// CheckRateLimits atomically consumes both test rate-limit scopes or neither.
func (m *MockClient) CheckRateLimits(ctx context.Context, firstKey string, firstLimit int, firstWindow time.Duration, secondKey string, secondLimit int, secondWindow time.Duration) (bool, int, time.Time, bool, int, time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	firstAllowed, firstRemaining, firstReset := m.checkRateLimitLocked(firstKey, firstLimit, firstWindow, false)
	secondAllowed, secondRemaining, secondReset := m.checkRateLimitLocked(secondKey, secondLimit, secondWindow, false)
	if firstAllowed && secondAllowed {
		firstAllowed, firstRemaining, firstReset = m.checkRateLimitLocked(firstKey, firstLimit, firstWindow, true)
		secondAllowed, secondRemaining, secondReset = m.checkRateLimitLocked(secondKey, secondLimit, secondWindow, true)
	}
	return firstAllowed, firstRemaining, firstReset, secondAllowed, secondRemaining, secondReset, nil
}

func (m *MockClient) Del(ctx context.Context, key string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.purgeExpiredLocked(key)
	_, ok := m.data[key]
	delete(m.data, key)
	delete(m.expires, key)
	delete(m.rateLimits, key)
	return ok, nil
}

func (m *MockClient) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "mock-id", nil
}

func (m *MockClient) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	return nil, nil
}

func (m *MockClient) XReadBlock(ctx context.Context, stream string, lastID string, count int64, block time.Duration) ([]goredis.XMessage, error) {
	return nil, nil
}

func (m *MockClient) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	return 0, nil
}

func (m *MockClient) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return errors.New("mock does not support watch")
}

func (m *MockClient) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	cmd.SetErr(errors.New("mock does not support eval"))
	return cmd
}

func (m *MockClient) RunScript(ctx context.Context, script *goredis.Script, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	cmd.SetErr(errors.New("mock does not support eval"))
	return cmd
}
