package tools

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCanonicalFacadeStatePorts(t *testing.T) {
	restores := []func(){
		SetArchiveWriter(nil),
		SetCSVWriter(nil),
		SetChartWriter(nil),
		SetDocumentWriter(nil),
		SetPDFWriter(nil),
		SetPresentationWriter(nil),
		SetSiteWriter(nil),
		SetSpreadsheetWriter(nil),
		SetWebFetchSource(nil),
	}
	for i := len(restores) - 1; i >= 0; i-- {
		restores[i]()
	}

	store := NewTodoStore()
	store.Set([]map[string]any{{"content": "one"}})
	clone := CloneTodoStore(store)
	assert.Equal(t, store.Get(), clone.Get())
	assert.NotSame(t, store, clone)
	assert.NotNil(t, CloneTodoStore(nil))

	plan := NewPlanStore()
	plan.Enter()
	planClone := ClonePlanStore(plan)
	assert.True(t, planClone.IsActive())
	assert.NotSame(t, plan, planClone)
	assert.False(t, ClonePlanStore(nil).IsActive())
}
