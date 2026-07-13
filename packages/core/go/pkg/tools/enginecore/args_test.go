package tools

import "testing"

func TestParseReadArgsDefaults(t *testing.T) {
	parsed, missing := parseReadArgs(map[string]any{"filePath": "a.txt"})
	if len(missing) != 0 {
		t.Fatalf("unexpected missing: %v", missing)
	}
	if parsed.filePath != "a.txt" {
		t.Fatalf("filePath = %q", parsed.filePath)
	}
	if parsed.offset != 0 || parsed.limit != 2000 {
		t.Fatalf("offset/limit = %d/%d", parsed.offset, parsed.limit)
	}
}

func TestParseWriteArgsMissing(t *testing.T) {
	_, missing := parseWriteArgs(map[string]any{})
	if len(missing) != 2 {
		t.Fatalf("expected 2 missing fields, got %v", missing)
	}
}

func TestParseQuestionArgsInvalid(t *testing.T) {
	_, missing, invalid := parseQuestionArgs(map[string]any{
		"questions": []any{
			map[string]any{
				"header":   "h",
				"question": "q",
			},
		},
	})
	if len(missing) != 0 {
		t.Fatalf("unexpected missing: %v", missing)
	}
	if !invalid {
		t.Fatalf("expected invalid questions")
	}
}

func TestParseQuestionArgsMissingWhenEmpty(t *testing.T) {
	_, missing, invalid := parseQuestionArgs(map[string]any{
		"questions": []any{},
	})
	if len(missing) != 1 || missing[0] != "missing questions" {
		t.Fatalf("expected missing questions, got %v", missing)
	}
	if invalid {
		t.Fatalf("expected invalid=false when questions are missing")
	}
}

func TestParseTodoArgsInvalid(t *testing.T) {
	_, missing, invalid := parseTodoArgs(map[string]any{
		"todos": []any{
			map[string]any{
				"content":  "",
				"status":   "todo",
				"priority": "high",
				"id":       "1",
			},
		},
	})
	if len(missing) != 0 {
		t.Fatalf("unexpected missing: %v", missing)
	}
	if !invalid {
		t.Fatalf("expected invalid todos")
	}
}
