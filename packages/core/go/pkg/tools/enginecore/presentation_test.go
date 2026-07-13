package tools

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

type fakePresentationWriter struct {
	err      error
	requests []PresentationWriteRequest
}

func (w *fakePresentationWriter) WritePresentation(_ context.Context, request PresentationWriteRequest) error {
	w.requests = append(w.requests, request)
	return w.err
}

func usePresentationWriter(t *testing.T, writer PresentationWriter) {
	t.Helper()
	restore := SetPresentationWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreatePresentation(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Cwd: tmpDir,
	}

	// Invalid empty
	res := toolCreatePresentation(ctx, map[string]any{})
	assert.Equal(t, "error", res.Status)

	// Invalid no slides
	res = toolCreatePresentation(ctx, map[string]any{
		"filePath": "test.pptx",
	})
	assert.Equal(t, "error", res.Status)

	// Valid
	writer := &fakePresentationWriter{}
	usePresentationWriter(t, writer)
	res = toolCreatePresentation(ctx, map[string]any{
		"filePath": "reports/slides/test.pptx",
		"slides": []any{
			map[string]any{
				"title": "Slide 1",
				"body":  "Content 1",
			},
		},
	})

	assert.Equal(t, "completed", res.Status)
	assert.True(t, res.TitleSet)
	if assert.Len(t, writer.requests, 1) {
		request := writer.requests[0]
		assert.Equal(t, filepath.Join(tmpDir, "reports", "slides", "test.pptx"), request.Path)
		assert.Equal(t, []PresentationSlide{{Title: "Slide 1", Body: "Content 1"}}, request.Slides)
	}

	// Test max slides
	slides := make([]any, MaxPresentationSlides+1)
	resMax := toolCreatePresentation(ctx, map[string]any{
		"filePath": "test_max.pptx",
		"slides":   slides,
	})
	assert.Equal(t, "error", resMax.Status)
	assert.Contains(t, resMax.Error, "exceeds maximum allowed")

	usePresentationWriter(t, &fakePresentationWriter{
		err: PresentationWriteError{Kind: PresentationWriteFailureDirectory, Err: assert.AnError},
	})
	resBlocked := toolCreatePresentation(ctx, map[string]any{
		"filePath": "blocked/out.pptx",
		"slides": []any{
			map[string]any{"title": "Blocked"},
		},
	})
	assert.Equal(t, "error", resBlocked.Status)
	assert.Contains(t, resBlocked.Error, "Error:")
}
