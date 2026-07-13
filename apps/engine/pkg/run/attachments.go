package run

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
)

// FileAttachment represents a binary file stored in Redis.
type FileAttachment struct {
	ID       string `json:"id" doc:"Unique identifier for the attachment"`
	Data     []byte `json:"-"`
	MimeType string `json:"mime_type" doc:"File MIME type"`
	Name     string `json:"name" doc:"Original filename"`
	Size     int64  `json:"size" doc:"File size in bytes"`
}

// AttachmentKeyPrefix is the Redis key prefix for attachment blobs.
const AttachmentKeyPrefix = "attachment_cache:"
const AttachmentMetaKeyPrefix = "attachment_meta:"

// Attachments carries all file attachments for a task.
type Attachments struct {
	Files []FileAttachment `json:"files,omitempty"`
}

func fetchAttachments(ctx context.Context, taskID string) (Attachments, error) {
	redisClient, redisErr := RedisClientGetter()
	redisUnavailable := redisErr != nil || redisClient == nil
	if redisUnavailable {
		if redisErr != nil {
			slog.Warn("[OrchestrateTask] Attachment cache unavailable; continuing without attachments", "taskId", taskID, "error", redisErr)
		}
		return Attachments{}, nil
	}

	key := AttachmentKeyPrefix + taskID
	data, getErr := redisClient.Get(ctx, key)
	noAttachmentPayload := getErr != nil || data == ""
	if noAttachmentPayload {
		if getErr != nil && !isRedisKeyNotFoundError(getErr) {
			slog.Warn("[OrchestrateTask] Failed to load attachment cache payload; continuing without attachments", "taskId", taskID, "error", getErr)
		}
		return Attachments{}, nil
	}

	var attachments Attachments
	if err := json.Unmarshal([]byte(data), &attachments); err != nil {
		slog.Warn("[OrchestrateTask] Failed to deserialize attachments", "taskId", taskID, "error", err)
		return Attachments{}, nil
	}

	resolved := make([]FileAttachment, 0, len(attachments.Files))
	missingCount := 0
	for _, f := range attachments.Files {
		metaKey := AttachmentMetaKeyPrefix + f.ID
		blob, err := redisClient.Get(ctx, metaKey)
		if err == nil && blob != "" {
			f.Data = []byte(blob)
			resolved = append(resolved, f)
			continue
		}
		missingCount++
	}

	if missingCount > 0 {
		return Attachments{}, fmt.Errorf("%d attachments could not be loaded", missingCount)
	}

	attachments.Files = resolved
	return attachments, nil
}

func buildUserMessage(prompt string, attachments Attachments) agent.ChatCompletionMessage {
	if len(attachments.Files) == 0 {
		return agent.ChatCompletionMessage{Role: agent.RoleUser, Content: prompt}
	}

	parts := []agent.ContentPart{
		{Type: agent.ContentPartText, Text: prompt},
	}
	for _, f := range attachments.Files {
		if part, ok := attachmentContentPart(f); ok {
			parts = append(parts, part)
		}
	}

	return agent.ChatCompletionMessage{
		Role:         agent.RoleUser,
		ContentParts: parts,
	}
}

func attachmentsToContentParts(attachments Attachments) []agent.ContentPart {
	parts := make([]agent.ContentPart, 0, len(attachments.Files))
	for _, f := range attachments.Files {
		if part, ok := attachmentContentPart(f); ok {
			parts = append(parts, part)
		}
	}
	return parts
}

func attachmentContentPart(file FileAttachment) (agent.ContentPart, bool) {
	switch {
	case strings.HasPrefix(file.MimeType, "image/"):
		dataURI := "data:" + file.MimeType + ";base64," + base64.StdEncoding.EncodeToString(file.Data)
		return agent.ContentPart{
			Type:     agent.ContentPartImageURL,
			ImageURL: &agent.ImageURLPart{URL: dataURI},
		}, true
	case strings.HasPrefix(file.MimeType, "audio/"):
		format := "wav"
		if strings.Contains(file.MimeType, "mp3") || strings.Contains(file.MimeType, "mpeg") {
			format = "mp3"
		}
		return agent.ContentPart{
			Type: agent.ContentPartInputAudio,
			InputAudio: &agent.InputAudioPart{
				Data:   base64.StdEncoding.EncodeToString(file.Data),
				Format: format,
			},
		}, true
	case strings.HasPrefix(file.MimeType, "video/") || isSupportedDocumentMIME(file.MimeType):
		return agent.ContentPart{
			Type: agent.ContentPartFileData,
			FileData: &agent.FileDataPart{
				FileURI:  file.ID,
				MimeType: file.MimeType,
			},
		}, true
	default:
		return agent.ContentPart{}, false
	}
}
