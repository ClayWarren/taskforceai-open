package engine

import "strings"

const (
	MaxAttachments             = 5
	MaxAttachmentBytes         = 20 * 1024 * 1024  // 20 MB decoded for standard, image, audio, and document attachments.
	MaxVideoAttachmentBytes    = 100 * 1024 * 1024 // 100 MB decoded for video attachments.
	MaxTotalAttachmentBytes    = 100 * 1024 * 1024 // 100 MB total decoded payload across all attachments.
	ImageGenerationModelID     = "google/gemini-2.5-flash-image-preview"
	VideoGenerationModelID     = "xai/grok-imagine-video-1.5"
	imageGenerationModelMarker = "gemini-2.5-flash-image"
)

var supportedImageMIME = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

var supportedVideoMIME = map[string]bool{
	"video/mp4":  true,
	"video/webm": true,
}

var supportedDocumentMIME = map[string]bool{
	"application/pdf": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"text/plain":       true,
	"text/markdown":    true,
	"application/json": true,
}

var supportedSpreadsheetMIME = map[string]bool{
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"text/csv": true,
}

var officeMIMEByExtension = map[string]string{
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

func NormalizeAttachmentMIME(value string) string {
	trimmed := strings.TrimSpace(value)
	if idx := strings.Index(trimmed, ";"); idx != -1 {
		trimmed = strings.TrimSpace(trimmed[:idx])
	}
	return strings.ToLower(trimmed)
}

func NormalizeUploadedAttachmentMIME(filename, detectedMIME string) string {
	normalized := NormalizeAttachmentMIME(detectedMIME)
	ext := strings.ToLower(strings.TrimSpace(filenameExtension(filename)))

	if mapped, ok := officeMIMEByExtension[ext]; ok {
		if normalized == "" || normalized == "application/zip" || normalized == "application/octet-stream" {
			return mapped
		}
	}

	if ext == ".csv" && (normalized == "text/plain" || normalized == "application/octet-stream") {
		return "text/csv"
	}

	return normalized
}

func IsSupportedAudioAttachmentMIME(mime string) bool {
	mime = NormalizeAttachmentMIME(mime)
	if !strings.HasPrefix(mime, "audio/") {
		return false
	}
	return strings.HasSuffix(mime, "/wav") || strings.HasSuffix(mime, "/wave") ||
		strings.HasSuffix(mime, "/mpeg") || strings.HasSuffix(mime, "/mp3") ||
		strings.HasSuffix(mime, "/webm") || strings.HasSuffix(mime, "/ogg")
}

func IsSupportedDocumentAttachmentMIME(mime string) bool {
	mime = NormalizeAttachmentMIME(mime)
	return supportedDocumentMIME[mime] || supportedSpreadsheetMIME[mime]
}

func IsVideoAttachmentMIME(mime string) bool {
	return strings.HasPrefix(NormalizeAttachmentMIME(mime), "video/")
}

func ModelSupportsVideoAttachments(modelID string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	return strings.Contains(normalized, "gemini")
}

func IsMediaGenerationModelID(modelID string) bool {
	return IsImageGenerationModelID(modelID) || strings.TrimSpace(strings.ToLower(modelID)) == VideoGenerationModelID
}

func IsImageGenerationModelID(modelID string) bool {
	model := strings.TrimSpace(strings.ToLower(modelID))
	return strings.Contains(model, imageGenerationModelMarker)
}

func NormalizeImageGenerationModelID(modelID string) string {
	trimmed := strings.TrimSpace(modelID)
	if strings.EqualFold(trimmed, "google/gemini-2.5-flash-image") ||
		strings.EqualFold(trimmed, "gemini-2.5-flash-image") {
		return ImageGenerationModelID
	}
	return trimmed
}

func AttachmentByteLimit(mime string) (int64, bool, string) {
	normalized := NormalizeAttachmentMIME(mime)
	switch {
	case strings.HasPrefix(normalized, "video/"):
		return attachmentLimitResult(MaxVideoAttachmentBytes, supportedVideoMIME[normalized], `unsupported video type "%s"; allowed: video/mp4, video/webm`)
	case strings.HasPrefix(normalized, "audio/"):
		return attachmentLimitResult(MaxAttachmentBytes, IsSupportedAudioAttachmentMIME(normalized), `unsupported audio format "%s"; allowed: wav, mp3, webm, ogg`)
	case strings.HasPrefix(normalized, "image/"):
		return attachmentLimitResult(MaxAttachmentBytes, supportedImageMIME[normalized], `unsupported image type "%s"; allowed: image/jpeg, image/png, image/gif, image/webp`)
	case IsSupportedDocumentAttachmentMIME(normalized):
		return MaxAttachmentBytes, true, ""
	default:
		return MaxAttachmentBytes, false, `unsupported attachment type "%s"`
	}
}

func attachmentLimitResult(limit int64, supported bool, unsupportedTemplate string) (int64, bool, string) {
	if supported {
		return limit, true, ""
	}
	return limit, false, unsupportedTemplate
}

func filenameExtension(filename string) string {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return ""
	}
	slash := strings.LastIndexAny(trimmed, `/\`)
	if slash >= 0 {
		trimmed = trimmed[slash+1:]
	}
	dot := strings.LastIndex(trimmed, ".")
	if dot <= 0 || dot == len(trimmed)-1 {
		return ""
	}
	return trimmed[dot:]
}
