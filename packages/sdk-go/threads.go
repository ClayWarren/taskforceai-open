package taskforceai

import (
	"context"
	"fmt"
	"time"
)

// Thread represents a conversation thread.
type Thread struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ThreadMessage represents a message within a thread.
type ThreadMessage struct {
	ID        int       `json:"id"`
	ThreadID  int       `json:"thread_id"`
	Role      string    `json:"role"` // "user" or "assistant"
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateThreadOptions contains options for creating a thread.
type CreateThreadOptions struct {
	Title    string          `json:"title,omitempty"`
	Messages []ThreadMessage `json:"messages,omitempty"`
	Metadata map[string]any  `json:"metadata,omitempty"`
}

// ThreadListResponse contains a list of threads.
type ThreadListResponse struct {
	Threads []Thread `json:"threads"`
	Total   int      `json:"total"`
}

// ThreadMessagesResponse contains messages from a thread.
type ThreadMessagesResponse struct {
	Messages []ThreadMessage `json:"messages"`
	Total    int             `json:"total"`
}

// ThreadRunOptions contains options for running a prompt in a thread.
type ThreadRunOptions struct {
	Prompt  string         `json:"prompt"`
	ModelID string         `json:"modelId,omitempty"`
	Options map[string]any `json:"options,omitempty"`
}

// ThreadRunResponse contains the result of running in a thread.
type ThreadRunResponse struct {
	TaskID    string `json:"task_id"`
	ThreadID  int    `json:"thread_id"`
	MessageID int    `json:"message_id"`
}

// CreateThread creates a new conversation thread.
func (c *Client) CreateThread(ctx context.Context, opts *CreateThreadOptions) (*Thread, error) {
	body := map[string]any{}
	if opts != nil {
		if opts.Title != "" {
			body["title"] = opts.Title
		}
		if len(opts.Messages) > 0 {
			body["messages"] = opts.Messages
		}
		if len(opts.Metadata) > 0 {
			body["metadata"] = opts.Metadata
		}
	}

	resp, err := c.doRequest(ctx, "POST", "/threads", body)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to create thread: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to create thread: status %d", resp.StatusCode)
	}

	var thread Thread
	if err := decodeJSON(resp.Body, &thread); err != nil {
		return nil, err
	}

	return &thread, nil
}

// ListThreads retrieves a list of threads.
func (c *Client) ListThreads(ctx context.Context, limit, offset int) (*ThreadListResponse, error) {
	path := fmt.Sprintf("/threads?limit=%d&offset=%d", limit, offset)

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to list threads: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to list threads: status %d", resp.StatusCode)
	}

	var result ThreadListResponse
	if err := decodeJSON(resp.Body, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// GetThread retrieves a specific thread by ID.
func (c *Client) GetThread(ctx context.Context, threadID int) (*Thread, error) {
	path := fmt.Sprintf("/threads/%d", threadID)

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to get thread: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to get thread: status %d", resp.StatusCode)
	}

	var thread Thread
	if err := decodeJSON(resp.Body, &thread); err != nil {
		return nil, err
	}

	return &thread, nil
}

// DeleteThread is currently unsupported because the Developer API has no thread delete endpoint.
func (c *Client) DeleteThread(ctx context.Context, threadID int) error {
	_ = ctx
	return fmt.Errorf(
		"DeleteThread is not supported by the current Developer API (threadID=%d)",
		threadID,
	)
}

// GetThreadMessages retrieves messages from a thread.
func (c *Client) GetThreadMessages(ctx context.Context, threadID int, limit, offset int) (*ThreadMessagesResponse, error) {
	path := fmt.Sprintf("/threads/%d/messages?limit=%d&offset=%d", threadID, limit, offset)

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to get thread messages: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to get thread messages: status %d", resp.StatusCode)
	}

	var result ThreadMessagesResponse
	if err := decodeJSON(resp.Body, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// RunInThread submits a prompt within a thread context.
func (c *Client) RunInThread(ctx context.Context, threadID int, opts ThreadRunOptions) (*ThreadRunResponse, error) {
	if opts.Prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}

	path := fmt.Sprintf("/threads/%d/runs", threadID)
	body := map[string]any{
		"prompt": opts.Prompt,
	}
	if opts.ModelID != "" {
		body["modelId"] = opts.ModelID
	}
	if len(opts.Options) > 0 {
		body["options"] = opts.Options
	}

	resp, err := c.doRequest(ctx, "POST", path, body)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, fmt.Errorf("failed to run in thread: response unavailable")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to run in thread: status %d", resp.StatusCode)
	}

	var result ThreadRunResponse
	if err := decodeJSON(resp.Body, &result); err != nil {
		return nil, err
	}

	return &result, nil
}
