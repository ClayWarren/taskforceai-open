package artifacts

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePDFWriter struct {
	err      error
	requests []PDFWriteRequest
}

func (w *fakePDFWriter) WritePDF(_ context.Context, request PDFWriteRequest) error {
	w.requests = append(w.requests, request)
	return w.err
}

func usePDFWriter(t *testing.T, writer PDFWriter) {
	t.Helper()
	restore := SetPDFWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreatePDFDelegatesToWriter(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Cwd: tmpDir,
	}
	writer := &fakePDFWriter{}
	usePDFWriter(t, writer)

	res := ExecutePDF(ctx, map[string]any{
		"filePath": "reports/nested/test.pdf",
		"title":    "My PDF",
		"sections": []any{
			map[string]any{
				"heading": "Section 1",
				"content": "Content 1",
			},
		},
	})

	require.Equal(t, "completed", res.Status)
	assert.True(t, res.TitleSet)
	if assert.Len(t, writer.requests, 1) {
		request := writer.requests[0]
		assert.Equal(t, filepath.Join(tmpDir, "reports", "nested", "test.pdf"), request.Path)
		assert.Equal(t, "My PDF", request.Title)
		assert.Equal(t, []DocumentSection{{Heading: "Section 1", Content: "Content 1"}}, request.Sections)
	}
}
