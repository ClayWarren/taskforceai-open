package permissionpolicy

import (
	"errors"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type capturePermission struct {
	request protocol.PermissionRequest
	err     error
}

func (permission *capturePermission) Ask(request protocol.PermissionRequest) error {
	permission.request = request
	return permission.err
}

func TestAsk(t *testing.T) {
	require.NoError(t, Ask(protocol.ToolContext{}, "read", map[string]any{"filePath": "a.txt"}))

	wantErr := errors.New("denied")
	permission := &capturePermission{err: wantErr}
	err := Ask(protocol.ToolContext{Permission: permission}, "read", map[string]any{"filePath": "a.txt"})
	require.ErrorIs(t, err, wantErr)
	assert.Equal(t, "read", permission.request.Permission)
	assert.Equal(t, []string{"a.txt"}, permission.request.Patterns)
	assert.Equal(t, []string{"*"}, permission.request.Always)
}

func TestPatterns(t *testing.T) {
	assert.Equal(t, []string{"file"}, Patterns(map[string]any{"filePath": "file", "path": "path"}))
	assert.Equal(t, []string{"path"}, Patterns(map[string]any{"path": "path", "pattern": "*.go"}))
	assert.Equal(t, []string{"*.go"}, Patterns(map[string]any{"pattern": "*.go"}))
	assert.Equal(t, []string{"https://example.com/a", "example.com"}, Patterns(map[string]any{"url": "https://example.com/a"}))
	assert.Equal(t, []string{"%"}, Patterns(map[string]any{"url": "%"}))
	assert.Nil(t, Patterns(map[string]any{}))
	assert.Nil(t, Patterns(map[string]any{"filePath": 1}))
}
