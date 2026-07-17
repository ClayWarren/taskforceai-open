package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuildBinaryDownloadHeaders(t *testing.T) {
	tests := []struct {
		name, contentType, disposition, wantMode, wantContentSecurity, wantFrameOptions string
	}{
		{"attachment", "text/html", " attachment ", "attachment", attachmentContentSecurityPolicy, "DENY"},
		{"inline passive content", "text/plain", " INLINE ", "inline", inlineContentSecurityPolicy, "SAMEORIGIN"},
		{"inline active content", " Text/HTML; charset=utf-8 ", "inline", "inline", activeContentSecurityPolicy, "SAMEORIGIN"},
		{"invalid media type remains passive", ` text/html; charset="unterminated`, "inline", "inline", inlineContentSecurityPolicy, "SAMEORIGIN"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			headers := BuildBinaryDownloadHeaders(tt.contentType, tt.disposition, "file.txt")
			assert.Equal(t, tt.wantMode+"; filename=file.txt", headers.ContentDisposition)
			assert.Equal(t, tt.wantContentSecurity, headers.ContentSecurityPolicy)
			assert.Equal(t, tt.wantFrameOptions, headers.FrameOptions)
		})
	}
}
