package network

import (
	"context"
	"errors"
	"testing"
)

func TestWebFetchSourceUnavailableAndNilBranches(t *testing.T) {
	ctx := context.Background()
	if _, err := (emptyWebFetchSource{}).Fetch(ctx, WebFetchRequest{}); !errors.Is(err, ErrWebFetchSourceUnavailable) {
		t.Fatalf("expected webfetch unavailable, got %v", err)
	}
	restore := SetWebFetchSource(nil)
	defer restore()
	if _, err := currentWebFetchSource().Fetch(ctx, WebFetchRequest{}); !errors.Is(err, ErrWebFetchSourceUnavailable) {
		t.Fatalf("nil webfetch source should install empty source, got %v", err)
	}
}
