package artifacts

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

type fakeDocumentWriter struct {
	err      error
	requests []DocumentWriteRequest
}

func (w *fakeDocumentWriter) WriteDocument(_ context.Context, request DocumentWriteRequest) error {
	w.requests = append(w.requests, request)
	return w.err
}

func useDocumentWriter(t *testing.T, writer DocumentWriter) {
	t.Helper()
	restore := SetDocumentWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreateDocument(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Cwd: tmpDir,
	}

	// Invalid empty
	res := ExecuteDocument(ctx, map[string]any{})
	assert.Equal(t, "error", res.Status)

	// Invalid no sections
	res = ExecuteDocument(ctx, map[string]any{
		"filePath": "test.docx",
		"title":    "My Doc",
	})
	assert.Equal(t, "error", res.Status)

	// Valid
	writer := &fakeDocumentWriter{}
	useDocumentWriter(t, writer)
	res = ExecuteDocument(ctx, map[string]any{
		"filePath": "test.docx",
		"title":    "My Doc",
		"sections": []any{
			map[string]any{
				"heading": "Section 1",
				"content": "Content 1",
			},
		},
	})

	assert.Equal(t, "completed", res.Status)
	assert.True(t, res.TitleSet)
	if assert.Len(t, writer.requests, 1) {
		request := writer.requests[0]
		assert.Equal(t, filepath.Join(tmpDir, "test.docx"), request.Path)
		assert.Equal(t, "My Doc", request.Title)
		assert.Equal(t, []DocumentSection{{Heading: "Section 1", Content: "Content 1"}}, request.Sections)
	}
}
