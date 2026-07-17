package tools

import (
	"context"
	"testing"
)

func TestTaskDoneTool(t *testing.T) {
	tool := CreateTaskDoneTool()
	ctx := context.Background()

	t.Run("Execute successfully", func(t *testing.T) {
		args := `{"task_summary": "done", "completion_message": "bye"}`
		res, err := tool.Execute(ctx, args)
		if err != nil {
			t.Fatal(err)
		}
		if res["status"] != "completed" {
			t.Errorf("expected completed status, got %v", res["status"])
		}
		if res["task_summary"] != "done" {
			t.Errorf("expected summary 'done', got %v", res["task_summary"])
		}
	})

	t.Run("Invalid JSON", func(t *testing.T) {
		_, err := tool.Execute(ctx, "{invalid}")
		if err == nil {
			t.Error("expected error for invalid JSON")
		}
	})

	t.Run("Missing required fields", func(t *testing.T) {
		_, err := tool.Execute(ctx, `{"task_summary":"done"}`)
		if err == nil {
			t.Error("expected validation error")
		}
	})
}
