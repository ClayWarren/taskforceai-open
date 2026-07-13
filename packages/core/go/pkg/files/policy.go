// Package files owns the product rules for user file storage: size limits,
// per-user storage budgets, and the MIME types users and agents may store.
package files

import "strings"

const (
	// MaxUploadSizeBytes is the maximum allowed size of a single file (10MB).
	MaxUploadSizeBytes = 10 * 1024 * 1024
	// DefaultUserStorageQuotaBytes is the default per-user storage budget (40GB).
	DefaultUserStorageQuotaBytes int64 = 40 * 1024 * 1024 * 1024
)

// allowedUploadMIMETypes is the set of MIME types permitted for user uploads.
var allowedUploadMIMETypes = map[string]bool{
	"text/plain":       true,
	"application/json": true,
	"application/pdf":  true,
	"image/png":        true,
	"image/jpeg":       true,
	"image/gif":        true,
	"image/webp":       true,
	"image/svg+xml":    true,
	"text/csv":         true,
	"text/markdown":    true,
}

// allowedGeneratedMIMETypes are additional document types agents may generate.
var allowedGeneratedMIMETypes = map[string]bool{
	"application/zip": true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"text/html": true,
}

// IsAllowedUploadMIMEType reports whether users may upload files of this type.
func IsAllowedUploadMIMEType(mimeType string) bool {
	return allowedUploadMIMETypes[strings.TrimSpace(mimeType)]
}

// IsAllowedStoredMIMEType reports whether a stored file may carry this type:
// user-uploadable types plus agent-generated document types.
func IsAllowedStoredMIMEType(mimeType string) bool {
	normalized := strings.TrimSpace(mimeType)
	return allowedUploadMIMETypes[normalized] || allowedGeneratedMIMETypes[normalized]
}
