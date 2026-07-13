package run

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	coreengine "github.com/TaskForceAI/core/pkg/engine"
)

const AttachmentInfoKeyPrefix = "attachment_info:"

type AttachmentInfo struct {
	MimeType string `json:"mimeType"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
}

var marshalAttachmentInfo = json.Marshal

func normalizeAttachmentMIMEFromFilename(filename, detectedMIME string) string {
	return coreengine.NormalizeUploadedAttachmentMIME(filename, detectedMIME)
}

func isSupportedDocumentMIME(mime string) bool {
	return coreengine.IsSupportedDocumentAttachmentMIME(mime)
}

func NormalizeUploadedAttachmentMIME(filename, detectedMIME string) string {
	return normalizeAttachmentMIMEFromFilename(filename, detectedMIME)
}

var StoreAttachmentInfo = func(ctx context.Context, fileID string, info AttachmentInfo, ttl time.Duration) error {
	redisClient, err := RedisClientGetter()
	if err != nil || redisClient == nil {
		return fmt.Errorf("redis unavailable")
	}

	data, err := marshalAttachmentInfo(info)
	if err != nil {
		return fmt.Errorf("encode attachment metadata: %w", err)
	}

	if err := redisClient.Set(ctx, AttachmentInfoKeyPrefix+fileID, data, ttl); err != nil {
		return fmt.Errorf("failed to store attachment metadata: %w", err)
	}

	return nil
}

var GetAttachmentInfo = func(ctx context.Context, fileID string) (*AttachmentInfo, bool, error) {
	redisClient, err := RedisClientGetter()
	if err != nil || redisClient == nil {
		return nil, false, fmt.Errorf("redis unavailable")
	}

	raw, err := redisClient.Get(ctx, AttachmentInfoKeyPrefix+fileID)
	if err != nil {
		if isRedisKeyNotFoundError(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if strings.TrimSpace(raw) == "" {
		return nil, false, nil
	}

	var info AttachmentInfo
	if err := json.Unmarshal([]byte(raw), &info); err != nil {
		return nil, false, fmt.Errorf("failed to decode attachment metadata: %w", err)
	}
	return &info, true, nil
}
