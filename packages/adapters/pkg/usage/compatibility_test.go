package usage_test

import (
	"context"
	"reflect"
	"testing"

	adapterusage "github.com/TaskForceAI/adapters/pkg/usage"
	coreusage "github.com/TaskForceAI/core/pkg/usage"
)

type testRepository struct{}

func (*testRepository) CreateTokenUsage(context.Context, []adapterusage.TokenUsageRow) error {
	return nil
}

func (*testRepository) CreateToolUsage(context.Context, []adapterusage.ToolUsageRow) error {
	return nil
}

var (
	_ adapterusage.TokenUsageRow          = coreusage.TokenUsageRow{}
	_ adapterusage.ToolUsageMetadata      = coreusage.ToolUsageMetadata{}
	_ adapterusage.ToolUsageRow           = coreusage.ToolUsageRow{}
	_ adapterusage.Repository             = (*testRepository)(nil)
	_ adapterusage.UsageRepository        = (*testRepository)(nil)
	_ adapterusage.TokenUsageRecord       = coreusage.TokenUsageRecord{}
	_ adapterusage.RecordTokenUsageParams = coreusage.RecordTokenUsageParams{}
	_ *adapterusage.TokenUsageRecorder    = (*coreusage.TokenUsageRecorder)(nil)
	_ adapterusage.ToolUsageRecord        = coreusage.ToolUsageRecord{}
	_ adapterusage.RecordToolUsageParams  = coreusage.RecordToolUsageParams{}
	_ *adapterusage.ToolUsageRecorder     = (*coreusage.ToolUsageRecorder)(nil)
	_ adapterusage.ModelCost              = coreusage.ModelCost{}
)

func TestCompatibilityFacade(t *testing.T) {
	if reflect.ValueOf(adapterusage.NewTokenUsageRecorder).Pointer() !=
		reflect.ValueOf(coreusage.NewTokenUsageRecorder).Pointer() {
		t.Fatal("NewTokenUsageRecorder must forward to core usage")
	}
	if reflect.ValueOf(adapterusage.NewToolUsageRecorder).Pointer() !=
		reflect.ValueOf(coreusage.NewToolUsageRecorder).Pointer() {
		t.Fatal("NewToolUsageRecorder must forward to core usage")
	}
	if !reflect.DeepEqual(adapterusage.DefaultModelCost, coreusage.DefaultModelCost) {
		t.Fatal("DefaultModelCost must match core usage")
	}
	if !reflect.DeepEqual(adapterusage.BaseModelCosts, coreusage.BaseModelCosts) {
		t.Fatal("BaseModelCosts must match core usage")
	}

	const overrides = `{"compat-model":{"prompt":1.5,"completion":2.5}}`
	got := adapterusage.ComputeModelCostUSD("compat-model", 123, 456, overrides)
	want := coreusage.ComputeModelCostUSD("compat-model", 123, 456, overrides)
	if got != want {
		t.Fatalf("ComputeModelCostUSD() = %v, want core result %v", got, want)
	}
}
