package tools

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestHistoricalImportPathForwardsCanonicalAPI(t *testing.T) {
	ctx := protocol.ToolContext{}
	args := map[string]any{}

	assert.Equal(t, "completed", NewToolResult(args).Status)
	assert.Equal(t, "error", ExecuteTool(ctx, "unknown", args).Status)
	assert.NotNil(t, NewTodoStore())
	assert.NotNil(t, CloneTodoStore(nil))

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

	results := []ToolResult{
		ToolRead(ctx, args),
		ToolWrite(ctx, args),
		ToolEdit(ctx, args),
		ToolGlob(ctx, args),
		ToolGrep(ctx, args),
		ToolCreateSpreadsheet(ctx, args),
		ToolCreateDocument(ctx, args),
		ToolCreatePresentation(ctx, args),
		ToolCreateArchive(ctx, args),
		ToolCreateCSV(ctx, args),
		ToolCreatePDF(ctx, args),
		ToolCreateChart(ctx, args),
		ToolCreateSite(ctx, args),
	}
	for _, result := range results {
		assert.Equal(t, "error", result.Status)
	}
}
