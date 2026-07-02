package taskforceai

import (
	"strings"
	"testing"
	"time"
)

func TestValidateTaskStatusBranches(t *testing.T) {
	validStatuses := []string{"processing", "completed", "failed", "awaiting_approval"}
	for _, status := range validStatuses {
		t.Run(status, func(t *testing.T) {
			err := validateTaskStatus(TaskStatus{TaskID: "task-1", Status: status}, "task status")
			if err != nil {
				t.Fatalf("expected %s to be valid: %v", status, err)
			}
		})
	}

	err := validateTaskStatus(TaskStatus{TaskID: " ", Status: "completed"}, "task status")
	if err == nil || !strings.Contains(err.Error(), "taskId is required") {
		t.Fatalf("expected missing task id error, got %v", err)
	}
}

func TestValidateThreadBranches(t *testing.T) {
	now := time.Now()
	valid := Thread{ID: 1, Title: "Thread", CreatedAt: now, UpdatedAt: now}
	if err := validateThread(valid, "thread"); err != nil {
		t.Fatalf("expected valid thread: %v", err)
	}

	tests := []struct {
		name string
		in   Thread
		want string
	}{
		{name: "missing id", in: Thread{Title: "Thread", CreatedAt: now, UpdatedAt: now}, want: "id must be positive"},
		{name: "missing title", in: Thread{ID: 1, CreatedAt: now, UpdatedAt: now}, want: "title is required"},
		{name: "missing created", in: Thread{ID: 1, Title: "Thread", UpdatedAt: now}, want: "created_at is required"},
		{name: "missing updated", in: Thread{ID: 1, Title: "Thread", CreatedAt: now}, want: "updated_at is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateThread(tt.in, "thread")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}

	err := validateThreadList(ThreadListResponse{Total: -1}, "thread list")
	if err == nil || !strings.Contains(err.Error(), "total must be non-negative") {
		t.Fatalf("expected negative total error, got %v", err)
	}
}

func TestValidateThreadMessageBranches(t *testing.T) {
	now := time.Now()
	valid := ThreadMessage{ID: 1, ThreadID: 1, Role: "user", Content: "hello", CreatedAt: now}
	if err := validateThreadMessage(valid, "message"); err != nil {
		t.Fatalf("expected valid user message: %v", err)
	}
	valid.Role = "assistant"
	if err := validateThreadMessage(valid, "message"); err != nil {
		t.Fatalf("expected valid assistant message: %v", err)
	}

	tests := []struct {
		name string
		in   ThreadMessage
		want string
	}{
		{name: "missing id", in: ThreadMessage{ThreadID: 1, Role: "user", CreatedAt: now}, want: "id must be positive"},
		{name: "missing thread id", in: ThreadMessage{ID: 1, Role: "user", CreatedAt: now}, want: "thread_id must be positive"},
		{name: "unsupported role", in: ThreadMessage{ID: 1, ThreadID: 1, Role: "system", CreatedAt: now}, want: "unsupported role"},
		{name: "missing created", in: ThreadMessage{ID: 1, ThreadID: 1, Role: "user"}, want: "created_at is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateThreadMessage(tt.in, "message")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}

	err := validateThreadMessages(ThreadMessagesResponse{Total: -1}, "messages")
	if err == nil || !strings.Contains(err.Error(), "total must be non-negative") {
		t.Fatalf("expected negative total error, got %v", err)
	}
}

func TestValidateThreadRunBranches(t *testing.T) {
	valid := ThreadRunResponse{TaskID: "task-1", ThreadID: 1, MessageID: 1}
	if err := validateThreadRun(valid, "thread run"); err != nil {
		t.Fatalf("expected valid thread run: %v", err)
	}

	tests := []struct {
		name string
		in   ThreadRunResponse
		want string
	}{
		{name: "missing task", in: ThreadRunResponse{ThreadID: 1, MessageID: 1}, want: "task_id is required"},
		{name: "missing thread", in: ThreadRunResponse{TaskID: "task-1", MessageID: 1}, want: "thread_id must be positive"},
		{name: "missing message", in: ThreadRunResponse{TaskID: "task-1", ThreadID: 1}, want: "message_id must be positive"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateThreadRun(tt.in, "thread run")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}
}

func TestValidateFileBranches(t *testing.T) {
	now := time.Now()
	valid := File{ID: "file-1", Filename: "file.txt", Purpose: "assistants", Bytes: 1, CreatedAt: now}
	if err := validateFile(valid, "file"); err != nil {
		t.Fatalf("expected valid file: %v", err)
	}

	tests := []struct {
		name string
		in   File
		want string
	}{
		{name: "missing id", in: File{Filename: "file.txt", Purpose: "assistants", Bytes: 1, CreatedAt: now}, want: "id is required"},
		{name: "missing filename", in: File{ID: "file-1", Purpose: "assistants", Bytes: 1, CreatedAt: now}, want: "filename is required"},
		{name: "missing purpose", in: File{ID: "file-1", Filename: "file.txt", Bytes: 1, CreatedAt: now}, want: "purpose is required"},
		{name: "negative bytes", in: File{ID: "file-1", Filename: "file.txt", Purpose: "assistants", Bytes: -1, CreatedAt: now}, want: "bytes must be non-negative"},
		{name: "missing created", in: File{ID: "file-1", Filename: "file.txt", Purpose: "assistants", Bytes: 1}, want: "created_at is required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateFile(tt.in, "file")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}

	err := validateFileList(FileListResponse{Total: -1}, "file list")
	if err == nil || !strings.Contains(err.Error(), "total must be non-negative") {
		t.Fatalf("expected negative total error, got %v", err)
	}
}
