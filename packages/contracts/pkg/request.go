package pkg

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

//

type ApiClientError struct {
	Status  int
	Body    string
	Message string
}

func (e *ApiClientError) Error() string {
	return fmt.Sprintf("API error (status %d): %s", e.Status, e.Message)
}

type ResiliencePolicy struct {
}

func NormalizeBaseURL(u string) string {
	trimmed := strings.TrimSpace(u)
	return strings.TrimRight(trimmed, "/")
}

type RequestContext struct {
	BaseURL    string
	HTTPClient *http.Client
	GetToken   func() string
}

const defaultHTTPClientTimeout = 30 * time.Second

var sharedHTTPClient = &http.Client{
	Timeout:   defaultHTTPClientTimeout,
	Transport: buildDefaultTransport(),
}

func buildDefaultTransport() http.RoundTripper {
	baseTransport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return http.DefaultTransport
	}

	transport := baseTransport.Clone()
	transport.MaxIdleConns = 100
	transport.MaxIdleConnsPerHost = 20
	transport.MaxConnsPerHost = 100
	transport.IdleConnTimeout = 90 * time.Second
	return transport
}

func NewRequestContext(baseURL string, getToken func() string) *RequestContext {
	return &RequestContext{
		BaseURL:    NormalizeBaseURL(baseURL),
		HTTPClient: sharedHTTPClient,
		GetToken:   getToken,
	}
}

func (c *RequestContext) Do(ctx context.Context, method, path string, body any, target any) (err error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bodyReader)
	if err != nil {
		return err
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	c.setAuthorizationHeader(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close response body: %w", closeErr)
		}
	}()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return fmt.Errorf("read error response body: %w", readErr)
		}
		return &ApiClientError{
			Status:  resp.StatusCode,
			Body:    string(respBody),
			Message: deriveAPIErrorMessage(resp.Status, respBody),
		}
	}

	if target != nil {
		return decodeResponseTarget(resp.Body, target)
	}

	return nil
}

func (c *RequestContext) setAuthorizationHeader(req *http.Request) {
	if c.GetToken == nil {
		return
	}
	token := c.GetToken()
	if token == "" {
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
}

func decodeResponseTarget(body io.Reader, target any) error {
	if targetString, ok := target.(*string); ok {
		return decodeStringResponse(body, targetString)
	}

	if decodeErr := json.NewDecoder(body).Decode(target); decodeErr != nil {
		if errors.Is(decodeErr, io.EOF) {
			return nil
		}
		return fmt.Errorf("decode response body: %w", decodeErr)
	}
	return nil
}

func decodeStringResponse(body io.Reader, target *string) error {
	data, readErr := io.ReadAll(body)
	if readErr != nil {
		return fmt.Errorf("read response body: %w", readErr)
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		*target = ""
		return nil
	}

	var decoded string
	if trimmed[0] == '"' {
		decodeStringErr := json.Unmarshal(trimmed, &decoded)
		if decodeStringErr == nil {
			*target = decoded
			return nil
		}
	}

	*target = string(trimmed)
	return nil
}

func deriveAPIErrorMessage(defaultMessage string, body []byte) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return defaultMessage
	}

	var payload map[string]any
	if err := json.Unmarshal(trimmed, &payload); err == nil {
		for _, key := range [...]string{"detail", "message", "error"} {
			if msg := extractAPIErrorMessage(payload[key]); msg != "" {
				return msg
			}
		}
	}

	return string(trimmed)
}

func extractAPIErrorMessage(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		for _, item := range typed {
			if msg := extractAPIErrorMessage(item); msg != "" {
				return msg
			}
		}
	case map[string]any:
		for _, key := range [...]string{"message", "detail", "error"} {
			if msg := extractAPIErrorMessage(typed[key]); msg != "" {
				return msg
			}
		}
	}
	return ""
}
