package enginecoreadapter

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreFileSiteWriter(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "site.html")

	err := (enginecoreFileSiteWriter{}).WriteSite(context.Background(), enginecoretools.SiteWriteRequest{
		Path:    target,
		Content: []byte("<!doctype html>"),
	})
	require.NoError(t, err)

	created, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "<!doctype html>", string(created))
}
