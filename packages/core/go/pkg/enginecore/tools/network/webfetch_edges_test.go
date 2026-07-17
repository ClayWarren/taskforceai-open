package network

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWebFetchEdgeBranches(t *testing.T) {
	ctx := protocol.ToolContext{Ctx: context.Background()}

	useWebFetchSource(t, &fakeWebFetchSource{err: errors.New("request failed")})
	res := ExecuteWebFetch(ctx, map[string]any{"url": "http://example.com"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "request failed")

	useWebFetchSource(t, &fakeWebFetchSource{err: ErrWebFetchConnection})
	res = ExecuteWebFetch(ctx, map[string]any{"url": "http://example.com"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Unable to connect")

	useWebFetchSource(t, &fakeWebFetchSource{err: errors.New("read failed")})
	res = ExecuteWebFetch(ctx, map[string]any{"url": "http://example.com"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "read failed")

	useWebFetchSource(t, &fakeWebFetchSource{err: errors.New("close failed")})
	res = ExecuteWebFetch(ctx, map[string]any{"url": "http://example.com"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "close failed")

	require.ErrorContains(t, validateWebFetchURL("http:///path"), "invalid URL")
}
