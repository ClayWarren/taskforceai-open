package taskforceai

import (
	"fmt"
	"strings"
)

func validateTaskID(taskID, label string) error {
	if strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("invalid %s response: taskId is required", label)
	}
	return nil
}

func validateTaskStatus(status TaskStatus, label string) error {
	if err := validateTaskID(status.TaskID, label); err != nil {
		return err
	}
	switch status.Status {
	case "processing", "completed", "failed", "awaiting_approval":
		return nil
	default:
		return fmt.Errorf("invalid %s response: unsupported status %q", label, status.Status)
	}
}

func validateThread(thread Thread, label string) error {
	if thread.ID <= 0 {
		return fmt.Errorf("invalid %s response: id must be positive", label)
	}
	if strings.TrimSpace(thread.Title) == "" {
		return fmt.Errorf("invalid %s response: title is required", label)
	}
	if thread.CreatedAt.IsZero() {
		return fmt.Errorf("invalid %s response: created_at is required", label)
	}
	if thread.UpdatedAt.IsZero() {
		return fmt.Errorf("invalid %s response: updated_at is required", label)
	}
	return nil
}

func validateThreadList(result ThreadListResponse, label string) error {
	if result.Total < 0 {
		return fmt.Errorf("invalid %s response: total must be non-negative", label)
	}
	for index, thread := range result.Threads {
		if err := validateThread(thread, fmt.Sprintf("%s thread %d", label, index)); err != nil {
			return err
		}
	}
	return nil
}

func validateThreadMessage(message ThreadMessage, label string) error {
	if message.ID <= 0 {
		return fmt.Errorf("invalid %s response: id must be positive", label)
	}
	if message.ThreadID <= 0 {
		return fmt.Errorf("invalid %s response: thread_id must be positive", label)
	}
	if message.Role != "user" && message.Role != "assistant" {
		return fmt.Errorf("invalid %s response: unsupported role %q", label, message.Role)
	}
	if message.CreatedAt.IsZero() {
		return fmt.Errorf("invalid %s response: created_at is required", label)
	}
	return nil
}

func validateThreadMessages(result ThreadMessagesResponse, label string) error {
	if result.Total < 0 {
		return fmt.Errorf("invalid %s response: total must be non-negative", label)
	}
	for index, message := range result.Messages {
		if err := validateThreadMessage(message, fmt.Sprintf("%s message %d", label, index)); err != nil {
			return err
		}
	}
	return nil
}

func validateThreadRun(result ThreadRunResponse, label string) error {
	if strings.TrimSpace(result.TaskID) == "" {
		return fmt.Errorf("invalid %s response: task_id is required", label)
	}
	if result.ThreadID <= 0 {
		return fmt.Errorf("invalid %s response: thread_id must be positive", label)
	}
	if result.MessageID <= 0 {
		return fmt.Errorf("invalid %s response: message_id must be positive", label)
	}
	return nil
}

func validateFile(file File, label string) error {
	if strings.TrimSpace(file.ID) == "" {
		return fmt.Errorf("invalid %s response: id is required", label)
	}
	if strings.TrimSpace(file.Filename) == "" {
		return fmt.Errorf("invalid %s response: filename is required", label)
	}
	if strings.TrimSpace(file.Purpose) == "" {
		return fmt.Errorf("invalid %s response: purpose is required", label)
	}
	if file.Bytes < 0 {
		return fmt.Errorf("invalid %s response: bytes must be non-negative", label)
	}
	if file.CreatedAt.IsZero() {
		return fmt.Errorf("invalid %s response: created_at is required", label)
	}
	return nil
}

func validateFileList(result FileListResponse, label string) error {
	if result.Total < 0 {
		return fmt.Errorf("invalid %s response: total must be non-negative", label)
	}
	for index, file := range result.Files {
		if err := validateFile(file, fmt.Sprintf("%s file %d", label, index)); err != nil {
			return err
		}
	}
	return nil
}
