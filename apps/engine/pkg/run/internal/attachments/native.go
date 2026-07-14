package attachments

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	attachmentcontract "github.com/TaskForceAI/go-engine/pkg/run/attachment"
	llmpkg "github.com/TaskForceAI/infrastructure/llm/pkg"
)

func UploadNative(ctx context.Context, adapter agent.ILLMClient, modelID string, attachments *attachmentcontract.Collection) error {
	uploader, ok := adapter.(agent.IFileUploader)
	if !ok || len(attachments.Files) == 0 {
		return nil
	}
	uploadCtx := llmpkg.WithUploadModel(ctx, modelID)
	for i, f := range attachments.Files {
		if attachmentAlreadyUploaded(f.ID) || !shouldUploadNatively(f.MimeType) {
			continue
		}
		uri, err := uploader.UploadFile(uploadCtx, bytes.NewReader(f.Data), f.Name, f.MimeType)
		if err != nil {
			slog.Error("Native file upload failed", "filename", f.Name, "error", err)
			return fmt.Errorf("video upload failed: %w", err)
		}
		attachments.Files[i].ID = uri
	}
	return nil
}

func attachmentAlreadyUploaded(id string) bool {
	return strings.HasPrefix(id, "https://") || strings.HasPrefix(id, "file-")
}

func shouldUploadNatively(mimeType string) bool {
	return strings.HasPrefix(mimeType, "video/") || IsSupportedDocumentMIME(mimeType)
}
