package run

import (
	"context"
	"encoding/json"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	attachmentcontract "github.com/TaskForceAI/go-engine/pkg/run/attachment"
	attachmentservice "github.com/TaskForceAI/go-engine/pkg/run/internal/attachments"
)

type FileAttachment = attachmentcontract.File
type Attachments = attachmentcontract.Collection
type AttachmentInfo = attachmentcontract.Info

const (
	AttachmentKeyPrefix     = attachmentcontract.CollectionKeyPrefix
	AttachmentMetaKeyPrefix = attachmentcontract.BlobKeyPrefix
	AttachmentInfoKeyPrefix = attachmentcontract.InfoKeyPrefix
)

var (
	marshalAttachments    = json.Marshal
	marshalAttachmentInfo = json.Marshal
)

func attachmentDependencies() attachmentservice.Dependencies {
	return attachmentservice.Dependencies{
		RedisClient:       RedisClientGetter,
		MarshalCollection: marshalAttachments,
		MarshalInfo:       marshalAttachmentInfo,
	}
}

func fetchAttachments(ctx context.Context, taskID string) (Attachments, error) {
	return attachmentservice.Fetch(ctx, taskID, attachmentDependencies())
}

func buildUserMessage(prompt string, attachments Attachments) agent.ChatCompletionMessage {
	return attachmentservice.BuildUserMessage(prompt, attachments)
}

func attachmentsToContentParts(attachments Attachments) []agent.ContentPart {
	return attachmentservice.ContentParts(attachments)
}

func uploadNativeAttachments(ctx context.Context, adapter agent.ILLMClient, modelID string, attachments *Attachments) error {
	return attachmentservice.UploadNative(ctx, adapter, modelID, attachments)
}

func NormalizeUploadedAttachmentMIME(filename, detectedMIME string) string {
	return attachmentservice.NormalizeUploadedAttachmentMIME(filename, detectedMIME)
}

var StoreAttachmentInfo = func(ctx context.Context, fileID string, info AttachmentInfo, ttl time.Duration) error {
	return attachmentservice.StoreInfo(ctx, fileID, info, ttl, attachmentDependencies())
}

var GetAttachmentInfo = func(ctx context.Context, fileID string) (*AttachmentInfo, bool, error) {
	return attachmentservice.GetInfo(ctx, fileID, attachmentDependencies())
}

var StoreAttachments = func(ctx context.Context, attachments Attachments, taskID string) error {
	return attachmentservice.StoreCollection(ctx, attachments, taskID, attachmentTTL, attachmentDependencies())
}

var StoreAttachment = func(ctx context.Context, fileID string, data []byte, ttl time.Duration) error {
	return attachmentservice.StoreFile(ctx, fileID, data, ttl, attachmentDependencies())
}

var GetAttachment = func(ctx context.Context, fileID string) ([]byte, error) {
	return attachmentservice.GetFile(ctx, fileID, attachmentDependencies())
}
