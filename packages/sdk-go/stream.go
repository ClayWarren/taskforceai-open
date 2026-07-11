package taskforceai

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const maxSSELineLength = 1024 * 1024

type sseStream struct {
	taskID string
	ctx    context.Context
	cancel context.CancelFunc
	resp   *http.Response
	reader *bufio.Reader
}

func (c *Client) StreamTaskStatus(ctx context.Context, taskID string) (TaskStatusStream, error) {
	streamCtx, cancel := context.WithCancel(ctx)

	url := c.baseURL + "/stream/" + pathSegment(taskID)
	req, err := http.NewRequestWithContext(streamCtx, "GET", url, nil)
	if err != nil {
		cancel()
		return nil, err
	}

	req.Header.Set("Accept", "text/event-stream")
	c.addRequestMetadata(streamCtx, req)

	streamClient := *c.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}

	if c.responseHook != nil {
		c.responseHook(resp.StatusCode, resp.Header)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		_ = resp.Body.Close()
		cancel()
		return nil, fmt.Errorf("stream error: status %d, body: %s", resp.StatusCode, string(body))
	}

	return &sseStream{
		taskID: taskID,
		ctx:    streamCtx,
		cancel: cancel,
		resp:   resp,
		reader: bufio.NewReader(resp.Body),
	}, nil
}

func (s *sseStream) TaskID() string {
	return s.taskID
}

func (s *sseStream) Close() error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.resp != nil && s.resp.Body != nil {
		return s.resp.Body.Close()
	}
	return nil
}

func (s *sseStream) Next() (TaskStatus, error) {
	for {
		select {
		case <-s.ctx.Done():
			return TaskStatus{}, s.ctx.Err()
		default:
		}

		line, err := s.readLineWithLimit(maxSSELineLength)
		if err != nil {
			return TaskStatus{}, err
		}

		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}

		if strings.HasPrefix(line, "data:") {
			data := strings.TrimSpace(line[5:])
			var status TaskStatus
			if err := json.Unmarshal([]byte(data), &status); err != nil {
				return TaskStatus{}, err
			}
			return status, nil
		}
	}
}

func (s *sseStream) readLineWithLimit(maxLen int) (string, error) {
	var builder strings.Builder

	for {
		fragment, isPrefix, err := s.reader.ReadLine()
		if builder.Len()+len(fragment) > maxLen {
			_ = s.Close()
			return "", fmt.Errorf("sse line exceeds maximum length of %d bytes", maxLen)
		}

		if len(fragment) > 0 {
			_, _ = builder.Write(fragment)
		}

		if err != nil {
			return "", err
		}

		if !isPrefix {
			return builder.String(), nil
		}
	}
}

func (c *Client) RunTaskStream(ctx context.Context, prompt string, opts *TaskSubmissionOptions) (TaskStatusStream, error) {
	taskID, err := c.SubmitTask(ctx, prompt, opts)
	if err != nil {
		return nil, err
	}

	return c.StreamTaskStatus(ctx, taskID)
}
