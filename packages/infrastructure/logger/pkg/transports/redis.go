package transports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/TaskForceAI/logger/pkg"
	goredis "github.com/redis/go-redis/v9"
)

const (
	defaultRedisLogTimeout = 2 * time.Second
	defaultRedisMaxEntries = 10000
	defaultRedisLogKey     = "taskforce:logs"
	defaultRedisQueueSize  = 256
)

var ErrRedisLogQueueFull = errors.New("redis log queue is full")

type redisLogRequest struct {
	data []byte
	done chan error
}

type RedisTransport struct {
	client     goredis.Cmdable
	key        string
	timeout    time.Duration
	maxEntries int
	queue      chan redisLogRequest
}

func NewRedisTransport(url string, key string) (*RedisTransport, error) {
	if url == "" {
		return nil, fmt.Errorf("redis url is required")
	}

	options, err := goredis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redis url: %w", err)
	}

	key = strings.TrimSpace(key)
	if key == "" {
		key = defaultRedisLogKey
	}

	transport := &RedisTransport{
		client:     goredis.NewClient(options),
		key:        key,
		timeout:    defaultRedisLogTimeout,
		maxEntries: defaultRedisMaxEntries,
		queue:      make(chan redisLogRequest, defaultRedisQueueSize),
	}
	go transport.run()
	return transport, nil
}

func (t *RedisTransport) Name() string {
	return "redis"
}

func (t *RedisTransport) Log(entry pkg.LogEntry) error {
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if t.queue == nil {
		return t.write(data)
	}

	select {
	case t.queue <- redisLogRequest{data: data}:
		return nil
	default:
		return ErrRedisLogQueueFull
	}
}

func (t *RedisTransport) run() {
	for request := range t.queue {
		if request.done != nil {
			request.done <- nil
			close(request.done)
			continue
		}
		_ = t.write(request.data)
	}
}

func (t *RedisTransport) write(data []byte) error {
	timeout := t.timeout
	if timeout <= 0 {
		timeout = defaultRedisLogTimeout
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if t.maxEntries <= 0 {
		return t.client.RPush(ctx, t.key, data).Err()
	}

	_, err := t.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		pipe.RPush(ctx, t.key, data)
		pipe.LTrim(ctx, t.key, int64(-t.maxEntries), -1)
		return nil
	})
	return err
}

func (t *RedisTransport) Flush() error {
	if t.queue == nil {
		return nil
	}

	timeout := t.timeout
	if timeout <= 0 {
		timeout = defaultRedisLogTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	done := make(chan error, 1)
	select {
	case t.queue <- redisLogRequest{done: done}:
	case <-ctx.Done():
		return ctx.Err()
	}

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
