package taskforceai

import (
	"context"
	"encoding/json"
	"fmt"
)

// Thread represents a conversation thread.
type Thread struct {
	ID            int              `json:"id"`
	Timestamp     string           `json:"timestamp"`
	UserInput     string           `json:"user_input"`
	Result        string           `json:"result"`
	ExecutionTime int              `json:"execution_time"`
	Model         string           `json:"model"`
	AgentCount    int              `json:"agent_count"`
	Sources       []map[string]any `json:"sources"`
	AgentStatuses []map[string]any `json:"agentStatuses"`
	ToolEvents    []map[string]any `json:"toolEvents"`
}

// ThreadMessage represents a message within a thread.
type ThreadMessage struct {
	ID             int             `json:"id"`
	ThreadID       int             `json:"thread_id"`
	Role           string          `json:"role"` // "user" or "assistant"
	Content        string          `json:"content"`
	MessageID      string          `json:"message_id,omitempty"`
	CreatedAt      string          `json:"created_at,omitempty"`
	UpdatedAt      string          `json:"updated_at,omitempty"`
	Error          *string         `json:"error,omitempty"`
	Sources        json.RawMessage `json:"sources,omitempty"`
	ToolEvents     json.RawMessage `json:"tool_events,omitempty"`
	AgentStatuses  json.RawMessage `json:"agent_statuses,omitempty"`
	IsAgentStatus  bool            `json:"is_agent_status"`
	ElapsedSeconds *float64        `json:"elapsed_seconds,omitempty"`
	Rating         int32           `json:"rating"`
}

// CreateThreadOptions contains options for creating a thread.
type CreateThreadOptions struct {
	Title    string          `json:"title,omitempty"`
	Messages []ThreadMessage `json:"messages,omitempty"`
	Metadata map[string]any  `json:"metadata,omitempty"`
}

// ThreadListResponse contains a list of threads.
type ThreadListResponse struct {
	Conversations []Thread `json:"conversations"`
	Total         int      `json:"total"`
	Limit         int      `json:"limit"`
	Offset        int      `json:"offset"`
	HasMore       bool     `json:"has_more"`
}

// ThreadMessagesResponse contains messages from a thread.
type ThreadMessagesResponse struct {
	Messages  []ThreadMessage `json:"messages"`
	Truncated bool            `json:"truncated,omitempty"`
}

// ThreadRunOptions contains options for running a prompt in a thread.
type ThreadRunOptions struct {
	Prompt  string         `json:"prompt"`
	ModelID string         `json:"modelId,omitempty"`
	Stream  bool           `json:"stream,omitempty"`
	Options map[string]any `json:"-"` // Deprecated: unsupported by the current Developer API.
}

// ThreadRunResponse contains the result of running in a thread.
type ThreadRunResponse struct {
	TaskID string `json:"taskId"`
	Status string `json:"status"`
}

// CreateThread creates a new conversation thread.
func (c *Client) CreateThread(ctx context.Context, opts *CreateThreadOptions) (*Thread, error) {
	body := map[string]any{}
	if opts != nil {
		if opts.Title != "" {
			body["title"] = opts.Title
		}
	}

	resp, err := c.request(ctx, "POST", "/threads", body)
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
	if err := validateThread(thread, "thread"); err != nil {
		return nil, err
	}

	return &thread, nil
}

// ListThreads retrieves a list of threads.
func (c *Client) ListThreads(ctx context.Context, limit, offset int) (*ThreadListResponse, error) {
	path := fmt.Sprintf("/threads?limit=%d&offset=%d", limit, offset)

	resp, err := c.request(ctx, "GET", path, nil)
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
	if err := validateThreadList(result, "thread list"); err != nil {
		return nil, err
	}

	return &result, nil
}

// GetThread retrieves a specific thread by ID.
func (c *Client) GetThread(ctx context.Context, threadID int) (*Thread, error) {
	path := fmt.Sprintf("/threads/%d", threadID)

	resp, err := c.request(ctx, "GET", path, nil)
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
	if err := validateThread(thread, "thread"); err != nil {
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

	resp, err := c.request(ctx, "GET", path, nil)
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
	if err := validateThreadMessages(result, "thread messages"); err != nil {
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
	if opts.Stream {
		body["stream"] = true
	}

	resp, err := c.request(ctx, "POST", path, body)
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
	if err := validateThreadRun(result, "thread run"); err != nil {
		return nil, err
	}

	return &result, nil
}
