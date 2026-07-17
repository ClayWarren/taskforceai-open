package server

import (
	"mime"
	"strings"
)

const (
	attachmentContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
	inlineContentSecurityPolicy     = "default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
	activeContentSecurityPolicy     = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https:; style-src 'unsafe-inline' data: blob: https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: blob: https:; connect-src https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
)

// BinaryDownloadHeaders contains security-sensitive response headers for a binary download.
type BinaryDownloadHeaders struct {
	ContentDisposition    string
	ContentSecurityPolicy string
	FrameOptions          string
}

// BuildBinaryDownloadHeaders returns headers for attachment or inline binary content.
// The caller owns filename sanitization because acceptable filenames are application-specific.
func BuildBinaryDownloadHeaders(contentType, disposition, sanitizedFilename string) BinaryDownloadHeaders {
	mode, contentSecurityPolicy, frameOptions := "attachment", attachmentContentSecurityPolicy, "DENY"
	if strings.EqualFold(strings.TrimSpace(disposition), "inline") {
		mode, contentSecurityPolicy, frameOptions = "inline", inlineContentSecurityPolicy, "SAMEORIGIN"
		if isActiveBinaryContent(contentType) {
			contentSecurityPolicy = activeContentSecurityPolicy
		}
	}
	return BinaryDownloadHeaders{
		ContentDisposition:    mime.FormatMediaType(mode, map[string]string{"filename": sanitizedFilename}),
		ContentSecurityPolicy: contentSecurityPolicy,
		FrameOptions:          frameOptions,
	}
}

func isActiveBinaryContent(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(strings.ToLower(contentType)))
	if err != nil {
		mediaType = strings.TrimSpace(strings.ToLower(contentType))
	}
	switch mediaType {
	case "text/html", "application/xhtml+xml", "image/svg+xml":
		return true
	default:
		return false
	}
}
