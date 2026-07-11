package conversations

import (
	"testing"
)

func TestConversationShortSanitizePushTo95CoverageGapPaths(t *testing.T) {
	if got := sanitizeModel("gpt-4o"); got != "gpt-4o" {
		t.Fatalf("expected short model passthrough, got %q", got)
	}
	if got := sanitizeTitle("title"); got != "title" {
		t.Fatalf("expected short title passthrough, got %q", got)
	}
	if got := sanitizeResult("result"); got != "result" {
		t.Fatalf("expected short result passthrough, got %q", got)
	}
}
