package files

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAllowedUploadMIMEType(t *testing.T) {
	allowed := []string{
		"text/plain",
		"application/json",
		"application/pdf",
		"image/png",
		"image/jpeg",
		"image/gif",
		"image/webp",
		"image/svg+xml",
		"text/csv",
		"text/markdown",
	}
	for _, mimeType := range allowed {
		t.Run(mimeType, func(t *testing.T) {
			assert.True(t, IsAllowedUploadMIMEType("  "+mimeType+"  "))
			assert.True(t, IsAllowedStoredMIMEType(mimeType))
		})
	}

	assert.False(t, IsAllowedUploadMIMEType("application/x-msdownload"))
	assert.False(t, IsAllowedUploadMIMEType(""))
}

func TestIsAllowedStoredMIMEType(t *testing.T) {
	generatedOnly := []string{
		"application/zip",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"text/html",
	}
	for _, mimeType := range generatedOnly {
		t.Run(mimeType, func(t *testing.T) {
			assert.False(t, IsAllowedUploadMIMEType(mimeType))
			assert.True(t, IsAllowedStoredMIMEType("  "+mimeType+"  "))
		})
	}

	assert.False(t, IsAllowedStoredMIMEType("application/x-msdownload"))
	assert.False(t, IsAllowedStoredMIMEType(""))
}

func TestStorageLimits(t *testing.T) {
	assert.Equal(t, 10*1024*1024, MaxUploadSizeBytes)
	assert.Equal(t, int64(40)*1024*1024*1024, DefaultUserStorageQuotaBytes)
}
