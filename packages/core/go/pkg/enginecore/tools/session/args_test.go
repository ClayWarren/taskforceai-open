package session

import "testing"

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
