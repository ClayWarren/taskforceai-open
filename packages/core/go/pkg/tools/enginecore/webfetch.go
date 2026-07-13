package tools

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// ErrWebFetchSourceUnavailable is returned when no outer webfetch source is installed.
var ErrWebFetchSourceUnavailable = errors.New("webfetch source unavailable")

// ErrWebFetchConnection tells the core tool to report a generic connectivity failure.
var ErrWebFetchConnection = errors.New("webfetch connection failed")

// ErrWebFetchPrivateAddress reports SSRF/private-network blocks from the outer source.
var ErrWebFetchPrivateAddress = errors.New("requests to private/internal addresses are not allowed")

// WebFetchRequest is the network request the core webfetch tool delegates outward.
type WebFetchRequest struct {
	URL string
}

// WebFetchResponse is the network response shape consumed by the core webfetch tool.
type WebFetchResponse struct {
	StatusCode  int
	Body        []byte
	ContentType string
}

// WebFetchSource performs concrete network access outside the core package.
type WebFetchSource interface {
	Fetch(context.Context, WebFetchRequest) (WebFetchResponse, error)
}

type emptyWebFetchSource struct{}

func (emptyWebFetchSource) Fetch(context.Context, WebFetchRequest) (WebFetchResponse, error) {
	return WebFetchResponse{}, ErrWebFetchSourceUnavailable
}

var webFetchSources = runtimevalue.New[WebFetchSource](emptyWebFetchSource{})

// SetWebFetchSource installs the outer source used by webfetch and returns a restore function.
func SetWebFetchSource(source WebFetchSource) func() {
	return webFetchSources.Set(source)
}

func currentWebFetchSource() WebFetchSource {
	return webFetchSources.Current()
}

func toolWebFetch(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	parsed := parseWebFetchArgs(args)
	if parsed.url == "" {
		state.Status = "error"
		state.Error = "Error: url is required"
		return state
	}
	if err := validateWebFetchURL(parsed.url); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	resp, err := currentWebFetchSource().Fetch(ctx.Ctx, WebFetchRequest{URL: parsed.url})
	if err != nil {
		state.Status = "error"
		if errors.Is(err, ErrWebFetchConnection) {
			state.Error = "Error: Unable to connect. Is the computer able to access the url?"
			return state
		}
		state.Error = "Error: " + err.Error()
		return state
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		state.Status = "error"
		state.Error = "Error: Request failed with status code: " + strconv.Itoa(resp.StatusCode)
		return state
	}
	contentType := resp.ContentType
	if contentType == "" {
		contentType = "text/plain"
	}
	state.Output = string(resp.Body)
	state.Title = parsed.url + " (" + contentType + ")"
	state.TitleSet = true
	state.Metadata = map[string]any{
		"truncated": false,
	}
	return state
}

func validateWebFetchURL(rawURL string) error {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("URL must start with http:// or https://")
	}
	if parsedURL.Host == "" {
		return fmt.Errorf("invalid URL")
	}
	return nil
}
