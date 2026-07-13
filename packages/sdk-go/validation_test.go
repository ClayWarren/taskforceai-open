package taskforceai

import (
	"strings"
	"testing"
)

func TestValidateTaskStatusBranches(t *testing.T) {
	validStatuses := []string{"processing", "completed", "failed", "canceled", "awaiting_approval"}
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
	valid := Thread{ID: 1, Timestamp: "2026-01-01T00:00:00Z"}
	if err := validateThread(valid, "thread"); err != nil {
		t.Fatalf("expected valid thread: %v", err)
	}

	tests := []struct {
		name string
		in   Thread
		want string
	}{
		{name: "missing id", in: Thread{Timestamp: "now"}, want: "id must be positive"},
		{name: "missing timestamp", in: Thread{ID: 1}, want: "timestamp is required"},
		{name: "negative execution time", in: Thread{ID: 1, Timestamp: "now", ExecutionTime: -1}, want: "execution_time must be non-negative"},
		{name: "negative agent count", in: Thread{ID: 1, Timestamp: "now", AgentCount: -1}, want: "agent_count must be non-negative"},
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
	err = validateThreadList(ThreadListResponse{Limit: -1}, "thread list")
	if err == nil || !strings.Contains(err.Error(), "pagination values") {
		t.Fatalf("expected pagination error, got %v", err)
	}
}

func TestValidateThreadMessageBranches(t *testing.T) {
	valid := ThreadMessage{ID: 1, ThreadID: 1, Role: "user", Content: "hello"}
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
		{name: "missing id", in: ThreadMessage{ThreadID: 1, Role: "user"}, want: "id must be positive"},
		{name: "missing thread id", in: ThreadMessage{ID: 1, Role: "user"}, want: "thread_id must be positive"},
		{name: "unsupported role", in: ThreadMessage{ID: 1, ThreadID: 1, Role: "system"}, want: "unsupported role"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateThreadMessage(tt.in, "message")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}
}

func TestValidateThreadRunBranches(t *testing.T) {
	valid := ThreadRunResponse{TaskID: "task-1", Status: "processing"}
	if err := validateThreadRun(valid, "thread run"); err != nil {
		t.Fatalf("expected valid thread run: %v", err)
	}

	tests := []struct {
		name string
		in   ThreadRunResponse
		want string
	}{
		{name: "missing task", in: ThreadRunResponse{Status: "processing"}, want: "task_id is required"},
		{name: "missing status", in: ThreadRunResponse{TaskID: "task-1"}, want: "status is required"},
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
	valid := File{ID: "file-1", Filename: "file.txt", Purpose: "assistants", Bytes: 1, CreatedAt: 1_767_225_600}
	if err := validateFile(valid, "file"); err != nil {
		t.Fatalf("expected valid file: %v", err)
	}

	tests := []struct {
		name string
		in   File
		want string
	}{
		{name: "missing id", in: File{Filename: "file.txt", Purpose: "assistants", Bytes: 1}, want: "id is required"},
		{name: "missing filename", in: File{ID: "file-1", Purpose: "assistants", Bytes: 1}, want: "filename is required"},
		{name: "missing purpose", in: File{ID: "file-1", Filename: "file.txt", Bytes: 1}, want: "purpose is required"},
		{name: "negative bytes", in: File{ID: "file-1", Filename: "file.txt", Purpose: "assistants", Bytes: -1}, want: "bytes must be non-negative"},
		{name: "negative created", in: File{ID: "file-1", Filename: "file.txt", Purpose: "assistants", Bytes: 1, CreatedAt: -1}, want: "created_at must be non-negative"},
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
