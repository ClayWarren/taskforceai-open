package taskcontrol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
)

const (
	approvalDecisionKeyPrefix       = "task:approval:decision:"
	approvalDecisionTTL             = 35 * time.Minute
	MaxApprovalDecisionPayloadBytes = 64 * 1024
)

var (
	ErrApprovalDecisionPayloadTooLarge = errors.New("approval decision payload too large")
)

type ApprovalDecision = taskcontract.ApprovalDecision

type ApprovalClient interface {
	Publish(ctx context.Context, channel string, payload []byte) error
}

type ApprovalDependencies struct {
	RedisClient    func() (redis.Cmdable, error)
	ApprovalClient func() (ApprovalClient, error)
}

type redisApprovalClient struct {
	client *goredis.Client
}

func (c redisApprovalClient) Publish(ctx context.Context, channel string, payload []byte) error {
	return c.client.Publish(ctx, channel, payload).Err()
}

var getApprovalClient = func() (ApprovalClient, error) {
	client, err := redis.GetPubSubClient()
	if err != nil {
		return nil, err
	}
	return redisApprovalClient{client: client}, nil
}

var RedisClientGetter = redis.GetClient

func DefaultApprovalClient() (ApprovalClient, error) {
	return getApprovalClient()
}

func approvalDecisionKey(taskID string) string {
	return approvalDecisionKeyPrefix + taskID
}

func persistApprovalDecision(ctx context.Context, taskID string, decision ApprovalDecision, getRedisClient func() (redis.Cmdable, error)) error {
	redisClient, err := getRedisClient()
	if err != nil {
		return err
	}
	if redisClient == nil {
		return errors.New("redis unavailable")
	}

	payload, err := json.Marshal(decision)
	if err != nil {
		return fmt.Errorf("marshal approval decision: %w", err)
	}
	return redisClient.Set(ctx, approvalDecisionKey(taskID), payload, approvalDecisionTTL)
}

func marshalApprovalDecisionPayload(decision ApprovalDecision) ([]byte, error) {
	payload, err := json.Marshal(decision)
	if err != nil {
		return nil, fmt.Errorf("marshal approval decision: %w", err)
	}
	if len(payload) > MaxApprovalDecisionPayloadBytes {
		return nil, fmt.Errorf("%w: max=%d bytes", ErrApprovalDecisionPayloadTooLarge, MaxApprovalDecisionPayloadBytes)
	}
	return payload, nil
}

// Global helper to send decision from API
func SendApprovalDecisionWithDependencies(ctx context.Context, taskID string, decision ApprovalDecision, deps ApprovalDependencies) error {
	if deps.RedisClient == nil {
		deps.RedisClient = RedisClientGetter
	}
	if deps.ApprovalClient == nil {
		deps.ApprovalClient = getApprovalClient
	}
	payload, err := marshalApprovalDecisionPayload(decision)
	if err != nil {
		return err
	}

	persistErr := persistApprovalDecision(ctx, taskID, decision, deps.RedisClient)
	if persistErr != nil {
		slog.Warn("[ApprovalDecision] Failed to persist approval decision", "taskId", taskID, "error", persistErr)
	}

	channel := fmt.Sprintf("task:approval:%s", taskID)
	client, clientErr := deps.ApprovalClient()
	if clientErr != nil {
		if persistErr != nil {
			return fmt.Errorf("persist approval decision: %w", persistErr)
		}
		slog.Warn("[ApprovalDecision] Pub/Sub unavailable; relying on stored approval decision", "taskId", taskID, "error", clientErr)
		return nil
	}

	if publishErr := client.Publish(ctx, channel, payload); publishErr != nil {
		if persistErr != nil {
			return fmt.Errorf("persist approval decision: %w", persistErr)
		}
		slog.Warn("[ApprovalDecision] Failed to publish approval decision; relying on stored decision", "taskId", taskID, "error", publishErr)
		return nil
	}
	if persistErr != nil {
		return fmt.Errorf("persist approval decision: %w", persistErr)
	}
	return nil
}

var SendApprovalDecision = func(ctx context.Context, taskID string, decision ApprovalDecision) error {
	return SendApprovalDecisionWithDependencies(ctx, taskID, decision, ApprovalDependencies{})
}
