package server

import (
	"errors"
	"net/http"
	"testing"

	"github.com/danielgtaylor/huma/v2"
)

func TestEnsureJSONPayloadWithinBudget(t *testing.T) {
	size, err := EnsureJSONPayloadWithinBudget(map[string]string{"ok": "yes"}, 64)
	if err != nil {
		t.Fatalf("expected payload within budget: %v", err)
	}
	if size == 0 {
		t.Fatal("expected non-zero payload size")
	}

	_, err = EnsureJSONPayloadWithinBudget(map[string]string{"tooBig": "abcdef"}, 8)
	if !errors.Is(err, ErrPayloadBudgetExceeded) {
		t.Fatalf("expected ErrPayloadBudgetExceeded, got %v", err)
	}

	_, err = EnsureJSONPayloadWithinBudget(map[string]any{"bad": make(chan int)}, 64)
	if err == nil {
		t.Fatal("expected marshal error for non-json payload")
	}
}

func TestTrimSliceForJSONBudget(t *testing.T) {
	items := []string{"first", "second", "third"}
	trimmed, wasTrimmed, _, err := TrimSliceForJSONBudget(items, func(values []string) any {
		return map[string]any{"items": values, "truncated": true}
	}, 42)
	if err != nil {
		t.Fatalf("trim slice: %v", err)
	}
	if !wasTrimmed {
		t.Fatal("expected slice to be trimmed")
	}
	if len(trimmed) >= len(items) {
		t.Fatalf("expected fewer items, got %d", len(trimmed))
	}
}

func TestTrimSliceForJSONBudgetErrors(t *testing.T) {
	_, _, _, err := TrimSliceForJSONBudget([]string{"first"}, nil, 10)
	if err == nil {
		t.Fatal("expected nil builder error")
	}

	_, _, _, err = TrimSliceForJSONBudget([]string{"first"}, func([]string) any {
		return map[string]any{"bad": make(chan int)}
	}, 10)
	if err == nil {
		t.Fatal("expected marshal error")
	}

	trimmed, wasTrimmed, _, err := TrimSliceForJSONBudget([]string{}, func([]string) any {
		return map[string]any{"oversized": "abcdef"}
	}, 4)
	if !errors.Is(err, ErrPayloadBudgetExceeded) {
		t.Fatalf("expected ErrPayloadBudgetExceeded, got %v", err)
	}
	if !wasTrimmed {
		t.Fatal("expected empty slice payload to report trimming attempt")
	}
	if len(trimmed) != 0 {
		t.Fatalf("expected empty slice to remain empty, got %d items", len(trimmed))
	}
}

func TestBinaryPayloadExceedsVercelLimit(t *testing.T) {
	if BinaryPayloadExceedsVercelLimit(int64(VercelFunctionSafeBinaryPayloadBytes)) {
		t.Fatal("expected exact safe limit to be allowed")
	}
	if !BinaryPayloadExceedsVercelLimit(int64(VercelFunctionSafeBinaryPayloadBytes + 1)) {
		t.Fatal("expected payload above safe limit to be rejected")
	}
}

func TestPayloadTooLargeError(t *testing.T) {
	err := PayloadTooLargeError("response too large")
	var statusErr huma.StatusError
	if !errors.As(err, &statusErr) {
		t.Fatalf("expected huma status error, got %T", err)
	}
	if statusErr.GetStatus() != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", statusErr.GetStatus())
	}
	if err.Error() != "response too large" {
		t.Fatalf("unexpected error message: %q", err.Error())
	}
}
