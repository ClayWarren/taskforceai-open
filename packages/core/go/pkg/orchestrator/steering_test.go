package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestApplyPendingSteeringAppendsGuidanceAndDrainsProvider(t *testing.T) {
	calls := 0
	orch := &TaskOrchestrator{steeringProvider: func(context.Context) ([]string, error) {
		calls++
		if calls == 1 {
			return []string{" focus on the protocol ", ""}, nil
		}
		return nil, nil
	}}
	query := orch.applyPendingSteering(context.Background(), "original")
	if !strings.Contains(query, "original") || !strings.Contains(query, "focus on the protocol") {
		t.Fatalf("expected steering in query, got %q", query)
	}
	if got := orch.applyPendingSteering(context.Background(), query); got != query {
		t.Fatalf("expected drained provider to leave query unchanged, got %q", got)
	}
}

func TestApplyPendingSteeringKeepsQueryOnProviderFailure(t *testing.T) {
	orch := &TaskOrchestrator{steeringProvider: func(context.Context) ([]string, error) {
		return nil, errors.New("unavailable")
	}}
	if got := orch.applyPendingSteering(context.Background(), "original"); got != "original" {
		t.Fatalf("expected original query, got %q", got)
	}
}

func TestApplyPendingSteeringCapsTotalPromptGrowth(t *testing.T) {
	accepted := strings.Repeat("a", MaxPendingSteeringBytes-len(steeringPromptPrefix))
	rejected := "must not be appended"
	orch := &TaskOrchestrator{steeringProvider: func(context.Context) ([]string, error) {
		return []string{accepted, rejected}, nil
	}}

	query := orch.applyPendingSteering(context.Background(), "original")
	if len(query)-len("original") != MaxPendingSteeringBytes {
		t.Fatalf("steering grew prompt by %d bytes, want %d", len(query)-len("original"), MaxPendingSteeringBytes)
	}
	if strings.Contains(query, rejected) {
		t.Fatal("expected guidance beyond the aggregate budget to be discarded")
	}
}
