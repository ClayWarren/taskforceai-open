package conversations

import (
	"strings"
	"testing"
)

func TestConversationSanitizeCoverageGapPaths(t *testing.T) {
	longModel := strings.Repeat("m", maxModelLength+10)
	if got := sanitizeModel(longModel); len(got) != maxModelLength {
		t.Fatalf("expected truncated model length %d, got %d", maxModelLength, len(got))
	}
	if got := sanitizeTitle(strings.Repeat("t", maxTitleLength+5)); len(got) != maxTitleLength {
		t.Fatalf("expected truncated title length %d, got %d", maxTitleLength, len(got))
	}
	if got := sanitizeResult(strings.Repeat("r", maxResultLength+5)); len(got) != maxResultLength {
		t.Fatalf("expected truncated result length %d, got %d", maxResultLength, len(got))
	}
}
