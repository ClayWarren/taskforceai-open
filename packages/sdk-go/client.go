package taskforceai

import (
	"bytes"
	"context"
	"encoding/base64"
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

var validateSubmitTaskRequest = func(body SubmitTaskRequest) error {
	return body.Validate()
}

func pathSegment(value string) string {
	return url.PathEscape(value)
}

func apiRootURL(baseURL string) string {
	return strings.TrimSuffix(baseURL, "/developer")
}

type Client struct {
	apiKey                string
	baseURL               string
	timeout               time.Duration
	responseHook          func(statusCode int, header map[string][]string)
	mockMode              bool
	httpClient            *http.Client
	requestHook           func(context.Context, string, string, any) (*http.Response, error)
	doRequestInternalHook func(context.Context, string, string, any) (*http.Response, error)
	uploadRequestHook     func(*http.Request) (*http.Response, error)
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

func (c *Client) request(ctx context.Context, method, path string, body any) (*http.Response, error) {
	if c.requestHook != nil {
		return c.requestHook(ctx, method, path, body)
	}
	return c.doRequest(ctx, method, path, body)
}

func (c *Client) requestSuccessful(ctx context.Context, method, path string, body any, operation string, status int) (*http.Response, error) {
	resp, err := c.request(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to %s: response unavailable", operation)
	}
	if (status == 0 && (resp.StatusCode < 200 || resp.StatusCode >= 300)) || (status != 0 && resp.StatusCode != status) {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("failed to %s: status %d", operation, resp.StatusCode)
	}
	return resp, nil
}

func decodeValidated[T any](r io.Reader, label string, validate func(T, string) error) (*T, error) {
	var result T
	if err := json.NewDecoder(r).Decode(&result); err != nil {
		return nil, err
	}
	if err := validate(result, label); err != nil {
		return nil, err
	}
	return &result, nil
}

func requestDecoded[T any](c *Client, ctx context.Context, method, path string, body any, operation string, status int, label string, validate func(T, string) error) (*T, error) {
	resp, err := c.requestSuccessful(ctx, method, path, body, operation, status)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	return decodeValidated(resp.Body, label, validate)
}

func decodeJSON(r io.Reader, v any) error {
	return json.NewDecoder(r).Decode(v)
}

func (c *Client) doRequest(ctx context.Context, method, path string, body any) (*http.Response, error) {
	maxAttempts := 1
	if isIdempotentMethod(method) {
		maxAttempts = 3
	}
	var lastResp *http.Response
	var lastErr error
	doRequestInternal := c.doRequestInternal
	if c.doRequestInternalHook != nil {
		doRequestInternal = c.doRequestInternalHook
	}

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

		lastResp, lastErr = doRequestInternal(ctx, method, path, body)
		if lastErr == nil {
			if lastResp == nil {
				break
			}
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

func isIdempotentMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodPut, http.MethodDelete:
		return true
	default:
		return false
	}
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
		body.AttachmentIDs = append(body.AttachmentIDs, opts.AttachmentIDs...)
		if len(opts.Images) > 0 {
			attachmentIDs, err := c.uploadImageAttachments(ctx, opts.Images)
			if err != nil {
				return "", err
			}
			body.AttachmentIDs = append(body.AttachmentIDs, attachmentIDs...)
		}
	}

	if err := validateSubmitTaskRequest(body); err != nil {
		return "", fmt.Errorf("validation error: %w", err)
	}

	resp, err := c.request(ctx, "POST", "/run", body)
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
	if err := validateTaskID(result.TaskID, "task submission"); err != nil {
		return "", err
	}

	return result.TaskID, nil
}

func (c *Client) uploadImageAttachments(ctx context.Context, images []ImageAttachment) ([]string, error) {
	ids := make([]string, 0, len(images))
	for index, image := range images {
		encoded := image.Data
		if comma := strings.LastIndex(encoded, ","); comma >= 0 {
			encoded = encoded[comma+1:]
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("decode image attachment %d: %w", index, err)
		}
		name := image.Name
		if name == "" {
			name = "attachment"
		}
		id, err := c.UploadAttachment(ctx, name, bytes.NewReader(data), image.MimeType)
		if err != nil {
			return nil, fmt.Errorf("upload image attachment %d: %w", index, err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (c *Client) GetTaskStatus(ctx context.Context, taskID string) (TaskStatus, error) {
	resp, err := c.request(ctx, "GET", "/status/"+pathSegment(taskID), nil)
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
	if err := validateTaskStatus(status, "task status"); err != nil {
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
		if status.Status == "canceled" {
			errMsg := "task canceled"
			if status.Error != nil && strings.TrimSpace(*status.Error) != "" {
				errMsg = *status.Error
			}
			return status, fmt.Errorf("%s", errMsg)
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
