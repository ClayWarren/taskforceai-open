package filesystem

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
