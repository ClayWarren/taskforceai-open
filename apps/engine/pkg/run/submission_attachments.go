package run

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	coreengine "github.com/TaskForceAI/core/pkg/engine"
)

func ValidateTaskAttachments(attachments Attachments) error {
	attachmentCount := len(attachments.Files)
	if attachmentCount == 0 {
		return nil
	}
	if attachmentCount > MaxAttachments {
		return fmt.Errorf("too many attachments: maximum %d allowed", MaxAttachments)
	}

	totalBytes := int64(0)

	for _, a := range attachments.Files {
		limit, supported, unsupportedTemplate := coreengine.AttachmentByteLimit(a.MimeType)
		if !supported {
			return fmt.Errorf(unsupportedTemplate, a.MimeType)
		}

		if int64(len(a.Data)) > limit {
			return fmt.Errorf("attachment %q exceeds maximum size of %d MB", a.Name, limit/(1024*1024))
		}

		totalBytes += int64(len(a.Data))
		if totalBytes > MaxTotalAttachmentBytes {
			return fmt.Errorf("total attachment payload exceeds maximum size of %d MB", MaxTotalAttachmentBytes/(1024*1024))
		}
	}

	return nil
}

var (
	marshalAttachments = json.Marshal

	StoreAttachments = func(ctx context.Context, attachments Attachments, taskID string) error {
		redisClient, err := RedisClientGetter()
		if err != nil || redisClient == nil {
			return fmt.Errorf("redis unavailable")
		}

		// We store the metadata in Redis, the actual data is already in Redis under individual file IDs
		data, marshalErr := marshalAttachments(attachments)
		if marshalErr != nil {
			return fmt.Errorf("encode attachments: %w", marshalErr)
		}

		key := AttachmentKeyPrefix + taskID
		if err := redisClient.Set(ctx, key, data, attachmentTTL); err != nil {
			return fmt.Errorf("failed to store attachments: %w", err)
		}

		return nil
	}

	StoreAttachment = func(ctx context.Context, fileID string, data []byte, ttl time.Duration) error {
		redisClient, err := RedisClientGetter()
		if err != nil || redisClient == nil {
			return fmt.Errorf("redis unavailable")
		}

		key := AttachmentMetaKeyPrefix + fileID
		if err := redisClient.Set(ctx, key, data, ttl); err != nil {
			return fmt.Errorf("failed to store binary attachment: %w", err)
		}

		return nil
	}

	GetAttachment = func(ctx context.Context, fileID string) ([]byte, error) {
		redisClient, err := RedisClientGetter()
		if err != nil || redisClient == nil {
			return nil, fmt.Errorf("redis unavailable")
		}

		key := AttachmentMetaKeyPrefix + fileID
		data, err := redisClient.Get(ctx, key)
		if err != nil {
			return nil, err
		}

		return []byte(data), nil
	}
)
