package submission

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
	"github.com/TaskForceAI/go-engine/pkg/run/internal/redisutil"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
	githubredis "github.com/redis/go-redis/v9"
)

func (s *Service) drainTaskSubmissionDeadLetterAsync(parentCtx context.Context, sender InngestSender) {
	if sender == nil {
		return
	}

	redisClient, redisErr := s.runtime.RedisClient()
	adapterhandler.Go("drainTaskSubmissionDeadLetter", func() {
		// Draining is detached from request cancellation but preserves trace values.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parentCtx), submissionDLQTimeout)
		defer cancel()
		drainErr := redisErr
		if drainErr == nil {
			drainErr = drainTaskSubmissionDeadLetterWithClient(ctx, sender, redisClient)
		}
		if drainErr != nil && !redisutil.IsStreamUnavailableError(drainErr) {
			slog.Warn("[RunSubmission] Failed to drain dead-letter stream", "error", drainErr)
		}
	})
}

func (s *Service) persistTaskSubmissionDeadLetter(
	ctx context.Context,
	taskID string,
	event inngestgo.GenericEvent[map[string]any],
	cause error,
) error {
	redisClient, err := s.runtime.RedisClient()
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
	if err != nil && !redisutil.IsStreamUnavailableError(err) {
		return err
	}
	if err == nil {
		if drainErr := drainTaskSubmissionDLQStreamRecords(ctx, sender, redisClient, records); drainErr != nil {
			return drainErr
		}
	}

	return drainTaskSubmissionDeadLetterFallback(ctx, redisClient, sender, 5)
}

func drainTaskSubmissionDLQStreamRecords(ctx context.Context, sender InngestSender, redisClient redis.Cmdable, records []githubredis.XMessage) error {
	for _, message := range records {
		payload, decodeErr := decodeTaskSubmissionDLQStreamMessage(message.Values)
		if decodeErr != nil {
			slog.Warn("[RunSubmission] DLQ message has an invalid payload; quarantining", "messageId", message.ID, "error", decodeErr)
			if cursorErr := advanceTaskSubmissionDLQCursor(ctx, redisClient, message.ID); cursorErr != nil {
				return cursorErr
			}
			continue
		}
		if sendErr := sendTaskEventWithResilience(ctx, sender, inngestgo.GenericEvent[map[string]any]{
			Name: payload.Name,
			Data: payload.Event,
		}); sendErr != nil {
			return sendErr
		}
		if cursorErr := advanceTaskSubmissionDLQCursor(ctx, redisClient, message.ID); cursorErr != nil {
			return cursorErr
		}
	}
	return nil
}

func decodeTaskSubmissionDLQStreamMessage(values map[string]any) (*taskSubmissionDLQPayload, error) {
	payloadRaw, ok := values["payload"]
	if !ok {
		return nil, errors.New("missing payload")
	}
	var payloadText string
	switch value := payloadRaw.(type) {
	case string:
		payloadText = value
	case []byte:
		payloadText = string(value)
	default:
		return nil, fmt.Errorf("unrecognized payload type %T", payloadRaw)
	}
	return decodeTaskSubmissionDLQPayload([]byte(payloadText))
}

func advanceTaskSubmissionDLQCursor(ctx context.Context, redisClient redis.Cmdable, messageID string) error {
	return redisClient.Set(ctx, dlqCursorKey, []byte(messageID), dlqTTL)
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
		if getErr != nil && !redisutil.IsKeyNotFoundError(getErr) {
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
		if redisutil.IsKeyNotFoundError(err) {
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
	if redisutil.IsKeyNotFoundError(err) {
		return "0-0", nil
	}
	return "", err
}
