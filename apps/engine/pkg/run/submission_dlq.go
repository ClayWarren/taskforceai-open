package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
)

func drainTaskSubmissionDeadLetterAsync(parentCtx context.Context, sender InngestSender) {
	if sender == nil {
		return
	}

	redisClient, redisErr := RedisClientGetter()
	adapterhandler.Go("drainTaskSubmissionDeadLetter", func() {
		// Draining is detached from request cancellation but preserves trace values.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parentCtx), submissionDLQTimeout)
		defer cancel()
		drainErr := redisErr
		if drainErr == nil {
			drainErr = drainTaskSubmissionDeadLetterWithClient(ctx, sender, redisClient)
		}
		if drainErr != nil && !isStreamUnavailableError(drainErr) {
			slog.Warn("[RunSubmission] Failed to drain dead-letter stream", "error", drainErr)
		}
	})
}

func persistTaskSubmissionDeadLetter(
	ctx context.Context,
	taskID string,
	event inngestgo.GenericEvent[map[string]any],
	cause error,
) error {
	redisClient, err := RedisClientGetter()
	if err != nil {
		return err
	}
	if redisClient == nil {
		return errors.New("redis unavailable")
	}
	payload := map[string]any{
		"taskId":    taskID,
		"name":      event.Name,
		"event":     event.Data,
		"failedAt":  time.Now().UTC().Format(time.RFC3339Nano),
		"error":     cause.Error(),
		"attempted": "submission",
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, streamErr := redisClient.XAdd(ctx, dlqStreamName, map[string]any{
		"payload": string(encoded),
	})
	if streamErr == nil {
		if _, trimErr := redisClient.XTrimMaxLen(ctx, dlqStreamName, dlqStreamMaxLen); trimErr != nil {
			slog.Warn("[RunSubmission] Failed to trim dead-letter stream", "error", trimErr)
		}
		return nil
	}
	// XAdd failed — log the stream error and fall back to a plain key so the
	// dead letter is not silently discarded.
	slog.Warn("[RunSubmission] XAdd to DLQ stream failed, falling back to Set", "taskId", taskID, "streamError", streamErr)
	seq, seqErr := redisClient.Incr(ctx, dlqFallbackSeqKey)
	if seqErr != nil {
		return seqErr
	}
	fallbackKey := dlqFallbackPrefix + strconv.Itoa(seq)
	return redisClient.Set(ctx, fallbackKey, encoded, dlqTTL)
}

func drainTaskSubmissionDeadLetterWithClient(ctx context.Context, sender InngestSender, redisClient redis.Cmdable) error {
	if redisClient == nil {
		return errors.New("redis unavailable")
	}
	cursor, err := loadTaskSubmissionDLQCursor(ctx, redisClient)
	if err != nil {
		return err
	}

	records, err := redisClient.XRead(ctx, dlqStreamName, cursor, 5)
	if err != nil && !isStreamUnavailableError(err) {
		return err
	}
	if err == nil {
		for _, message := range records {
			payloadRaw, ok := message.Values["payload"]
			if !ok {
				continue
			}
			var payloadText string
			switch v := payloadRaw.(type) {
			case string:
				payloadText = v
			case []byte:
				payloadText = string(v)
			default:
				slog.Warn("[RunSubmission] DLQ message has unrecognizable payload type, skipping", "messageId", message.ID, "type", fmt.Sprintf("%T", payloadRaw))
				continue
			}
			payload, decodeErr := decodeTaskSubmissionDLQPayload([]byte(payloadText))
			if decodeErr != nil {
				continue
			}
			if sendErr := sendTaskEventWithResilience(ctx, sender, inngestgo.GenericEvent[map[string]any]{
				Name: payload.Name,
				Data: payload.Event,
			}); sendErr != nil {
				return sendErr
			}

			if setErr := redisClient.Set(ctx, dlqCursorKey, []byte(message.ID), dlqTTL); setErr != nil {
				return setErr
			}
		}
	}

	return drainTaskSubmissionDeadLetterFallback(ctx, redisClient, sender, 5)
}

type taskSubmissionDLQPayload struct {
	TaskID string         `json:"taskId"`
	Name   string         `json:"name"`
	Event  map[string]any `json:"event"`
}

func decodeTaskSubmissionDLQPayload(raw []byte) (*taskSubmissionDLQPayload, error) {
	if len(raw) == 0 {
		return nil, errors.New("empty payload")
	}
	var payload taskSubmissionDLQPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.TaskID == "" || payload.Name == "" {
		return nil, errors.New("invalid payload")
	}
	return &payload, nil
}

func drainTaskSubmissionDeadLetterFallback(
	ctx context.Context,
	redisClient redis.Cmdable,
	sender InngestSender,
	maxEntries int,
) error {
	if maxEntries <= 0 {
		return nil
	}

	latestSeq, err := loadTaskSubmissionDLQSequence(ctx, redisClient, dlqFallbackSeqKey)
	if err != nil {
		return err
	}
	if latestSeq <= 0 {
		return nil
	}

	cursorSeq, err := loadTaskSubmissionDLQSequence(ctx, redisClient, dlqFallbackCursor)
	if err != nil {
		return err
	}

	processed := 0
	for seq := cursorSeq + 1; seq <= latestSeq && processed < maxEntries; seq++ {
		entryKey := dlqFallbackPrefix + strconv.Itoa(seq)
		payloadText, getErr := redisClient.Get(ctx, entryKey)
		if getErr != nil && !isRedisKeyNotFoundError(getErr) {
			return getErr
		}
		if getErr == nil && strings.TrimSpace(payloadText) != "" {
			payload, decodeErr := decodeTaskSubmissionDLQPayload([]byte(payloadText))
			if decodeErr == nil {
				if sendErr := sendTaskEventWithResilience(ctx, sender, inngestgo.GenericEvent[map[string]any]{
					Name: payload.Name,
					Data: payload.Event,
				}); sendErr != nil {
					return sendErr
				}
			}
			if _, delErr := redisClient.Del(ctx, entryKey); delErr != nil {
				slog.Warn("[RunSubmission] Failed to delete fallback dead-letter entry", "key", entryKey, "error", delErr)
			}
		}

		if setErr := redisClient.Set(ctx, dlqFallbackCursor, []byte(strconv.Itoa(seq)), dlqTTL); setErr != nil {
			return setErr
		}
		processed++
	}

	return nil
}

func loadTaskSubmissionDLQSequence(ctx context.Context, redisClient interface {
	Get(ctx context.Context, key string) (string, error)
}, key string) (int, error) {
	raw, err := redisClient.Get(ctx, key)
	if err != nil {
		if isRedisKeyNotFoundError(err) {
			return 0, nil
		}
		return 0, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	seq, parseErr := strconv.Atoi(raw)
	if parseErr != nil {
		return 0, parseErr
	}
	if seq < 0 {
		return 0, nil
	}
	return seq, nil
}

func loadTaskSubmissionDLQCursor(ctx context.Context, redisClient interface {
	Get(ctx context.Context, key string) (string, error)
}) (string, error) {
	cursor, err := redisClient.Get(ctx, dlqCursorKey)
	if err == nil {
		cursor = strings.TrimSpace(cursor)
		if cursor == "" {
			return "0-0", nil
		}
		return cursor, nil
	}
	if isRedisKeyNotFoundError(err) {
		return "0-0", nil
	}
	return "", err
}

func isRedisKeyNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "key not found") || strings.Contains(msg, "redis: nil")
}
