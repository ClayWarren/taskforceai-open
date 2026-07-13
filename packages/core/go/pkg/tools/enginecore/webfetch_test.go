package tools

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

type fakeWebFetchSource struct {
	response WebFetchResponse
	err      error
	request  WebFetchRequest
}

func (f *fakeWebFetchSource) Fetch(_ context.Context, request WebFetchRequest) (WebFetchResponse, error) {
	f.request = request
	if f.err != nil {
		return WebFetchResponse{}, f.err
	}
	return f.response, nil
}

func useWebFetchSource(t *testing.T, source WebFetchSource) {
	t.Helper()
	restore := SetWebFetchSource(source)
	t.Cleanup(restore)
}

func TestToolWebFetch(t *testing.T) {
	ctx := protocol.ToolContext{Ctx: context.Background()}

	t.Run("fetch success", func(t *testing.T) {
		source := &fakeWebFetchSource{response: WebFetchResponse{
			StatusCode:  200,
			Body:        []byte("web content"),
			ContentType: "text/plain; charset=utf-8",
		}}
		useWebFetchSource(t, source)

		args := map[string]any{"url": "https://example.com/page"}
		res := toolWebFetch(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, "web content", res.Output)
		assert.Equal(t, "https://example.com/page (text/plain; charset=utf-8)", res.Title)
		assert.Equal(t, "https://example.com/page", source.request.URL)
	})

	t.Run("fetch success defaults content type to text/plain", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{response: WebFetchResponse{StatusCode: 200}})

		res := toolWebFetch(ctx, map[string]any{"url": "https://example.com"})
		assert.Equal(t, "completed", res.Status)
		assert.Empty(t, res.Output)
		assert.Equal(t, "https://example.com (text/plain)", res.Title)
		assert.Equal(t, false, res.Metadata["truncated"])
	})

	t.Run("fetch ssrf protection", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{err: ErrWebFetchPrivateAddress})

		res := toolWebFetch(ctx, map[string]any{"url": "http://localhost:1234"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "private/internal addresses are not allowed")
	})

	t.Run("fetch blocks loopback literals", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{err: ErrWebFetchPrivateAddress})

		res := toolWebFetch(ctx, map[string]any{"url": "http://127.0.0.1:1234"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "private/internal addresses are not allowed")
	})

	t.Run("fetch missing url", func(t *testing.T) {
		res := toolWebFetch(ctx, map[string]any{})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "url is required")
	})

	t.Run("fetch invalid protocol", func(t *testing.T) {
		res := toolWebFetch(ctx, map[string]any{"url": "ftp://example.com"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "URL must start with http")
	})

	t.Run("fetch invalid url parse", func(t *testing.T) {
		res := toolWebFetch(ctx, map[string]any{"url": "http://%"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "invalid URL")
	})

	t.Run("fetch returns status code errors", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{response: WebFetchResponse{
			StatusCode: 503,
			Body:       []byte("unavailable"),
		}})

		res := toolWebFetch(ctx, map[string]any{"url": "https://example.com"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "status code: 503")
	})

	t.Run("fetch redirect loops are surfaced as connectivity errors", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{err: ErrWebFetchConnection})

		res := toolWebFetch(ctx, map[string]any{"url": "https://example.com"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Unable to connect")
	})

	t.Run("fetch source errors are surfaced", func(t *testing.T) {
		useWebFetchSource(t, &fakeWebFetchSource{err: errors.New("read failed")})

		res := toolWebFetch(ctx, map[string]any{"url": "https://example.com"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "read failed")
	})
}
