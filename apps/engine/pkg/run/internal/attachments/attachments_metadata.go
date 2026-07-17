package attachments

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	coreengine "github.com/TaskForceAI/core/pkg/engine"
	attachmentcontract "github.com/TaskForceAI/go-engine/pkg/run/attachment"
	"github.com/TaskForceAI/go-engine/pkg/run/internal/redisutil"
)

const AttachmentInfoKeyPrefix = attachmentcontract.InfoKeyPrefix

type AttachmentInfo = attachmentcontract.Info

func NormalizeUploadedAttachmentMIME(filename, detectedMIME string) string {
	return coreengine.NormalizeUploadedAttachmentMIME(filename, detectedMIME)
}

func IsSupportedDocumentMIME(mime string) bool {
	return coreengine.IsSupportedDocumentAttachmentMIME(mime)
}

func StoreInfo(ctx context.Context, fileID string, info AttachmentInfo, ttl time.Duration, deps Dependencies) error {
	redisClient, err := deps.RedisClient()
	if err != nil || redisClient == nil {
		return fmt.Errorf("redis unavailable")
	}

	data, err := deps.MarshalInfo(info)
	if err != nil {
		return fmt.Errorf("encode attachment metadata: %w", err)
	}

	if err := redisClient.Set(ctx, AttachmentInfoKeyPrefix+fileID, data, ttl); err != nil {
		return fmt.Errorf("failed to store attachment metadata: %w", err)
	}

	return nil
}

func GetInfo(ctx context.Context, fileID string, deps Dependencies) (*AttachmentInfo, bool, error) {
	redisClient, err := deps.RedisClient()
	if err != nil || redisClient == nil {
		return nil, false, fmt.Errorf("redis unavailable")
	}

	raw, err := redisClient.Get(ctx, AttachmentInfoKeyPrefix+fileID)
	if err != nil {
		if redisutil.IsKeyNotFoundError(err) {
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
