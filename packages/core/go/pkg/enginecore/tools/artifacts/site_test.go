package artifacts

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type denySitePermission struct{}

func (denySitePermission) Ask(protocol.PermissionRequest) error {
	return errors.New("permission denied")
}

type fakeSiteWriter struct {
	err     error
	request SiteWriteRequest
}

func (w *fakeSiteWriter) WriteSite(_ context.Context, request SiteWriteRequest) error {
	w.request = request
	return w.err
}

func useSiteWriter(t *testing.T, writer SiteWriter) {
	t.Helper()
	restore := SetSiteWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreateSite(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}

	tests := []struct {
		name string
		args map[string]any
		want string
	}{
		{
			name: "missing file path",
			args: map[string]any{"html": "<html></html>"},
			want: "missing filePath",
		},
		{
			name: "invalid extension",
			args: map[string]any{"filePath": "site.txt", "html": "<html></html>"},
			want: "filePath must end in .html or .htm",
		},
		{
			name: "blank html",
			args: map[string]any{"filePath": "site.html", "html": "   "},
			want: "missing html",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := ExecuteSite(ctx, tt.args)
			assert.Equal(t, "error", res.Status)
			assert.Contains(t, res.Error, tt.want)
		})
	}

	writer := &fakeSiteWriter{}
	useSiteWriter(t, writer)
	res := ExecuteSite(ctx, map[string]any{
		"filePath": "site.HTML",
		"title":    "Preview Site",
		"html":     "<!doctype html><title>Preview</title>",
	})

	require.Equal(t, "completed", res.Status, res.Error)
	assert.Equal(t, "site.HTML", res.Title)
	assert.True(t, res.TitleSet)
	assert.Equal(t, map[string]any{
		"filepath": "site.HTML",
		"kind":     "site",
		"title":    "Preview Site",
	}, res.Metadata)
	assert.Equal(t, filepath.Join(tmpDir, "site.HTML"), writer.request.Path)
	assert.Equal(t, "<!doctype html><title>Preview</title>", string(writer.request.Content))
}

func TestToolCreateSiteRejectsDeniedExternalWrites(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Cwd:        tmpDir,
		Permission: denySitePermission{},
	}

	res := ExecuteSite(ctx, map[string]any{
		"filePath": "../outside.html",
		"html":     "<!doctype html>",
	})

	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "permission denied")
}
