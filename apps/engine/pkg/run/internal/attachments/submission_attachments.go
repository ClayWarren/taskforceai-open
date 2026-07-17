package attachments

import (
	"context"
	"fmt"
	"time"

	coreengine "github.com/TaskForceAI/core/pkg/engine"
)

func ValidateTaskAttachments(attachments Attachments) error {
	attachmentCount := len(attachments.Files)
	if attachmentCount == 0 {
		return nil
	}
	if attachmentCount > coreengine.MaxAttachments {
		return fmt.Errorf("too many attachments: maximum %d allowed", coreengine.MaxAttachments)
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
		if totalBytes > coreengine.MaxTotalAttachmentBytes {
			return fmt.Errorf("total attachment payload exceeds maximum size of %d MB", coreengine.MaxTotalAttachmentBytes/(1024*1024))
		}
	}

	return nil
}

func StoreCollection(ctx context.Context, attachments Attachments, taskID string, ttl time.Duration, deps Dependencies) error {
	redisClient, err := deps.RedisClient()
	if err != nil || redisClient == nil {
		return fmt.Errorf("redis unavailable")
	}

	// We store the metadata in Redis, the actual data is already in Redis under individual file IDs
	data, marshalErr := deps.MarshalCollection(attachments)
	if marshalErr != nil {
		return fmt.Errorf("encode attachments: %w", marshalErr)
	}

	key := AttachmentKeyPrefix + taskID
	if err := redisClient.Set(ctx, key, data, ttl); err != nil {
		return fmt.Errorf("failed to store attachments: %w", err)
	}

	return nil
}

func StoreFile(ctx context.Context, fileID string, data []byte, ttl time.Duration, deps Dependencies) error {
	redisClient, err := deps.RedisClient()
	if err != nil || redisClient == nil {
		return fmt.Errorf("redis unavailable")
	}

	key := AttachmentMetaKeyPrefix + fileID
	if err := redisClient.Set(ctx, key, data, ttl); err != nil {
		return fmt.Errorf("failed to store binary attachment: %w", err)
	}

	return nil
}

func GetFile(ctx context.Context, fileID string, deps Dependencies) ([]byte, error) {
	redisClient, err := deps.RedisClient()
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
