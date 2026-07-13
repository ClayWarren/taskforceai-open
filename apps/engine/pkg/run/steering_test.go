package run

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/orchestrator"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func TestTaskSteeringPersistsAndProviderDrainsInOrder(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	redis.SetClient(redis.NewClient(rdb))
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	ctx := context.Background()
	if err := SendTaskSteering(ctx, "task-1", "first"); err != nil {
		t.Fatal(err)
	}
	if err := SendTaskSteering(ctx, "task-1", "second"); err != nil {
		t.Fatal(err)
	}
	if ttl := mr.TTL(taskSteeringStream("task-1")); ttl != TaskTTL {
		t.Fatalf("steering stream TTL = %s, want %s", ttl, TaskTTL)
	}
	provider := newTaskSteeringProvider("task-1")
	messages, err := provider(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0] != "first" || messages[1] != "second" {
		t.Fatalf("unexpected steering messages: %#v", messages)
	}
	messages, err = provider(ctx)
	if err != nil || len(messages) != 0 {
		t.Fatalf("expected drained provider, messages=%#v err=%v", messages, err)
	}
}

func TestTaskSteeringRejectsAggregateInputBeyondPromptBudget(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	redis.SetClient(redis.NewClient(rdb))
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	ctx := context.Background()
	chunk := strings.Repeat("x", maxTaskSteeringBytes)
	for range orchestrator.MaxPendingSteeringBytes / maxTaskSteeringBytes {
		if err := SendTaskSteering(ctx, "task-quota", chunk); err != nil {
			t.Fatal(err)
		}
	}
	if err := SendTaskSteering(ctx, "task-quota", "one more"); !errors.Is(err, ErrTaskSteeringQuota) {
		t.Fatalf("expected aggregate quota error, got %v", err)
	}
}

func TestTaskSteeringRejectsMessagesBeyondEntryQuota(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer rdb.Close()
	redis.SetClient(redis.NewClient(rdb))
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	ctx := context.Background()
	for range maxTaskSteeringEntries {
		if err := SendTaskSteering(ctx, "task-entry-quota", "x"); err != nil {
			t.Fatal(err)
		}
	}
	if err := SendTaskSteering(ctx, "task-entry-quota", "one more"); !errors.Is(err, ErrTaskSteeringQuota) {
		t.Fatalf("expected entry quota error, got %v", err)
	}
}

func TestTaskSteeringValidatesInput(t *testing.T) {
	if !errors.Is(SendTaskSteering(context.Background(), "task", " "), ErrTaskSteeringEmpty) {
		t.Fatal("expected empty steering error")
	}
	tooLarge := strings.Repeat("x", maxTaskSteeringBytes+1)
	if !errors.Is(SendTaskSteering(context.Background(), "task", tooLarge), ErrTaskSteeringTooLarge) {
		t.Fatal("expected oversized steering error")
	}
}

func TestTaskSteeringStoreFailures(t *testing.T) {
	t.Run("getter error", func(t *testing.T) {
		setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
			return nil, errors.New("redis offline")
		})
		if err := SendTaskSteering(context.Background(), "task", "guidance"); err == nil {
			t.Fatal("expected steering store error")
		}
	})
	t.Run("nil client", func(t *testing.T) {
		setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return nil, nil })
		if err := SendTaskSteering(context.Background(), "task", "guidance"); err == nil {
			t.Fatal("expected unavailable steering store error")
		}
	})
	t.Run("eval error", func(t *testing.T) {
		client := goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:0"})
		t.Cleanup(func() { _ = client.Close() })
		setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
			return redis.NewClient(client), nil
		})
		if err := SendTaskSteering(context.Background(), "task", "guidance"); err == nil {
			t.Fatal("expected steering persistence error")
		}
	})
}

func TestTaskSteeringProviderStoreFailures(t *testing.T) {
	t.Run("getter error", func(t *testing.T) {
		setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
			return nil, errors.New("redis offline")
		})
		_, err := newTaskSteeringProvider("task")(context.Background())
		if err == nil {
			t.Fatal("expected provider store error")
		}
	})
	t.Run("read error", func(t *testing.T) {
		client := goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:0"})
		t.Cleanup(func() { _ = client.Close() })
		setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
			return redis.NewClient(client), nil
		})
		_, err := newTaskSteeringProvider("task")(context.Background())
		if err == nil {
			t.Fatal("expected provider read error")
		}
	})
}
