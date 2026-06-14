package taskforceai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

const (
	DefaultBaseURL      = "https://taskforceai.chat/api/v1/developer"
	DefaultTimeout      = 30 * time.Second
	DefaultPollInterval = 1 * time.Second
	DefaultMaxPoll      = 60
	apiKeyHeader        = "x-api-key"
	maxRedirectHops     = 10
)

var errTooManyRedirects = errors.New("stopped after 10 redirects")

func pathSegment(value string) string {
	return url.PathEscape(value)
}

type Client struct {
	apiKey       string
	baseURL      string
	timeout      time.Duration
	responseHook func(statusCode int, header map[string][]string)
	mockMode     bool
	httpClient   *http.Client
}

func NewClient(opts TaskForceAIOptions) (*Client, error) {
	if !opts.MockMode && opts.APIKey == "" {
		return nil, fmt.Errorf("API key must be a non-empty string")
	}

	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}

	return &Client{
		apiKey:       opts.APIKey,
		baseURL:      baseURL,
		timeout:      timeout,
		responseHook: opts.ResponseHook,
		mockMode:     opts.MockMode,
		httpClient: &http.Client{
			Timeout:       timeout,
			CheckRedirect: stripAPIKeyOnCrossHostRedirect,
		},
	}, nil
}

func stripAPIKeyOnCrossHostRedirect(req *http.Request, via []*http.Request) error {
	if len(via) == 0 {
		return nil
	}
	if len(via) >= maxRedirectHops {
		return errTooManyRedirects
	}

	originRequest := via[0]
	if originRequest.URL.Host != req.URL.Host {
		req.Header.Del(apiKeyHeader)
	}

	return nil
}

func (c *Client) addRequestMetadata(ctx context.Context, req *http.Request) {
	if c.apiKey != "" {
		req.Header.Set(apiKeyHeader, c.apiKey)
	}
	req.Header.Set("X-SDK-Language", "go")
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
}

func (c *Client) doRequest(ctx context.Context, method, path string, body any) (*http.Response, error) {
	const maxAttempts = 3
	var lastResp *http.Response
	var lastErr error

	for attempt := range maxAttempts {
		if attempt > 0 {
			// Exponential backoff with jitter
			delay := time.Duration(math.Pow(2, float64(attempt-1))) * 500 * time.Millisecond
			jitter := time.Duration(rand.Int63n(int64(delay / 2))) // #nosec G404
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay + jitter):
			}
		}

		lastResp, lastErr = c.doRequestInternal(ctx, method, path, body)
		if lastErr == nil {
			if lastResp.StatusCode < 500 && lastResp.StatusCode != http.StatusTooManyRequests {
				return lastResp, nil
			}
			// Retryable status code (5xx or 429)
			if attempt < maxAttempts-1 {
				_ = lastResp.Body.Close()
				continue
			}
			return lastResp, nil
		}

		// Don't retry non-transient errors (like context deadline or canceled)
		if ctx.Err() != nil {
			return nil, lastErr
		}

		if attempt < maxAttempts-1 {
			continue
		}
	}

	if lastResp == nil && lastErr == nil {
		lastErr = fmt.Errorf("request completed without a response")
	}
	return lastResp, lastErr
}

func (c *Client) doRequestInternal(ctx context.Context, method, path string, body any) (*http.Response, error) {
	url := c.baseURL + path
	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	c.addRequestMetadata(ctx, req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}

	if c.responseHook != nil {
		c.responseHook(resp.StatusCode, resp.Header)
	}

	return resp, nil
}

func (c *Client) SubmitTask(ctx context.Context, prompt string, opts *TaskSubmissionOptions) (string, error) {
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}

	body := SubmitTaskRequest{
		Prompt: prompt,
	}
	if opts != nil {
		body.ModelID = opts.ModelID
		body.Options = opts
		if len(opts.Images) > 0 {
			body.Attachments = opts.Images
		}
	}

	if err := body.Validate(); err != nil {
		return "", fmt.Errorf("validation error: %w", err)
	}

	resp, err := c.doRequest(ctx, "POST", "/run", body)
	if err != nil {
		return "", err
	}
	if resp == nil {
		return "", fmt.Errorf("failed to submit task: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("failed to submit task: status %d, body: %s", resp.StatusCode, string(body))
	}

	var result struct {
		TaskID string `json:"taskId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.TaskID, nil
}

func (c *Client) GetTaskStatus(ctx context.Context, taskID string) (TaskStatus, error) {
	resp, err := c.doRequest(ctx, "GET", "/status/"+pathSegment(taskID), nil)
	if err != nil {
		return TaskStatus{}, err
	}
	if resp == nil {
		return TaskStatus{}, fmt.Errorf("failed to get task status: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return TaskStatus{}, fmt.Errorf("failed to get task status: status %d, body: %s", resp.StatusCode, string(body))
	}

	var status TaskStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return TaskStatus{}, err
	}

	return status, nil
}

func (c *Client) WaitForCompletion(ctx context.Context, taskID string, pollInterval time.Duration, maxAttempts int, callback TaskStatusCallback) (TaskStatus, error) {
	if pollInterval == 0 {
		pollInterval = DefaultPollInterval
	}
	if maxAttempts == 0 {
		maxAttempts = DefaultMaxPoll
	}

	for i := 0; i < maxAttempts; i++ {
		status, err := c.GetTaskStatus(ctx, taskID)
		if err != nil {
			return TaskStatus{}, err
		}

		if callback != nil {
			callback(status)
		}

		if status.Status == "completed" {
			return status, nil
		}
		if status.Status == "failed" {
			errMsg := "task failed"
			if status.Error != nil {
				errMsg = *status.Error
			}
			return status, fmt.Errorf("task failed: %s", errMsg)
		}
		if status.Status == "awaiting_approval" {
			errMsg := "task is awaiting approval"
			if status.Error != nil && strings.TrimSpace(*status.Error) != "" {
				errMsg = *status.Error
			}
			return status, fmt.Errorf("%s", errMsg)
		}

		select {
		case <-ctx.Done():
			return status, ctx.Err()
		case <-time.After(pollInterval):
		}
	}

	return TaskStatus{}, fmt.Errorf("task timed out")
}

func (c *Client) RunTask(ctx context.Context, prompt string, opts *TaskSubmissionOptions, pollInterval time.Duration, maxAttempts int, callback TaskStatusCallback) (TaskStatus, error) {
	taskID, err := c.SubmitTask(ctx, prompt, opts)
	if err != nil {
		return TaskStatus{}, err
	}

	return c.WaitForCompletion(ctx, taskID, pollInterval, maxAttempts, callback)
}
