package pkg

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type DefaultHttpClient struct {
	client *http.Client
}

const maxHTTPResponseBytes = 4 * 1024 * 1024

func NewDefaultHttpClient(timeout time.Duration) *DefaultHttpClient {
	return &DefaultHttpClient{
		client: &http.Client{
			Transport: otelhttp.NewTransport(http.DefaultTransport),
			Timeout:   timeout,
		},
	}
}

func (c *DefaultHttpClient) Get(ctx context.Context, url string, headers map[string]string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, 0, err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxHTTPResponseBytes+1))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if len(body) > maxHTTPResponseBytes {
		return nil, resp.StatusCode, fmt.Errorf("response body exceeds %d bytes", maxHTTPResponseBytes)
	}

	return body, resp.StatusCode, nil
}
