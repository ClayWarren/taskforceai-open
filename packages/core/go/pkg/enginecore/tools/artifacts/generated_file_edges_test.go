package artifacts

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeCSVRecordWriter struct {
	writeErr error
	flushErr error
}

func (f *fakeCSVRecordWriter) Write([]string) error { return f.writeErr }
func (f *fakeCSVRecordWriter) Flush()               {}
func (f *fakeCSVRecordWriter) Error() error         { return f.flushErr }

func TestGeneratedDocumentEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{
		"filePath": "reports/test.docx",
		"title":    "Title",
		"sections": []any{
			"skip",
			map[string]any{"heading": "Heading", "content": "Body"},
		},
	}

	useDocumentWriter(t, &fakeDocumentWriter{})

	res := ExecuteDocument(ctx, args)
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, "reports/test.docx", res.Metadata["filepath"])
	assert.Equal(t, 2, res.Metadata["sections"])

	useDocumentWriter(t, &fakeDocumentWriter{
		err: DocumentWriteError{Kind: DocumentWriteFailureFile, Err: errors.New("save failed")},
	})
	res = ExecuteDocument(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error saving document")

	useDocumentWriter(t, &fakeDocumentWriter{
		err: DocumentWriteError{Kind: DocumentWriteFailureDirectory, Err: errors.New("mkdir failed")},
	})
	res = ExecuteDocument(ctx, map[string]any{
		"filePath": "blocked/out.docx",
		"sections": []any{map[string]any{"content": "Body"}},
	})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error:")

	res = ExecuteDocument(ctx, map[string]any{
		"filePath": "../outside.docx",
		"sections": []any{map[string]any{"content": "Body"}},
	})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "external directory")
}

func TestGeneratedPresentationEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{
		"filePath": "slides/test.pptx",
		"slides": []any{
			"skip",
			map[string]any{"title": "Title", "body": "Body"},
			map[string]any{"title": "Title only"},
		},
	}

	usePresentationWriter(t, &fakePresentationWriter{})

	res := ExecutePresentation(ctx, args)
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, "slides/test.pptx", res.Metadata["filepath"])
	assert.Equal(t, 3, res.Metadata["slides"])

	usePresentationWriter(t, &fakePresentationWriter{
		err: PresentationWriteError{Kind: PresentationWriteFailureFile, Err: errors.New("save failed")},
	})
	res = ExecutePresentation(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error saving presentation")

	usePresentationWriter(t, &fakePresentationWriter{
		err: PresentationWriteError{Kind: PresentationWriteFailureDirectory, Err: errors.New("mkdir failed")},
	})
	res = ExecutePresentation(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error:")
}

func TestGeneratedCSVEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{
		"filePath": "out.csv",
		"rows":     []any{[]any{"a", "b"}},
	}

	previousWriter := createCSVRecordWriter
	t.Cleanup(func() { createCSVRecordWriter = previousWriter })
	useCSVFileWriter(t, &fakeCSVFileWriter{})

	createCSVRecordWriter = func(io.Writer) csvRecordWriter {
		return &fakeCSVRecordWriter{writeErr: errors.New("write failed")}
	}
	res := ExecuteCSV(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error writing CSV row")

	createCSVRecordWriter = func(io.Writer) csvRecordWriter {
		return &fakeCSVRecordWriter{flushErr: errors.New("flush failed")}
	}
	res = ExecuteCSV(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "CSV flush failed")

	createCSVRecordWriter = previousWriter
	useCSVFileWriter(t, &fakeCSVFileWriter{
		err: CSVWriteError{Kind: CSVWriteFailureDirectory, Err: errors.New("mkdir failed")},
	})
	res = ExecuteCSV(ctx, map[string]any{
		"filePath": "blocked/out.csv",
		"rows":     []any{[]any{"a"}},
	})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error creating CSV directory")

	useCSVFileWriter(t, &fakeCSVFileWriter{
		err: CSVWriteError{Kind: CSVWriteFailureFile, Err: errors.New("create failed")},
	})
	res = ExecuteCSV(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error creating CSV file")
}

func TestGeneratedArchiveEdges(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "f1.txt")
	require.NoError(t, os.WriteFile(filePath, []byte("data"), 0o600))
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{"filePath": "out.zip", "files": []any{"f1.txt"}}

	useArchiveWriter(t, &fakeArchiveFileWriter{
		err: ArchiveWriteError{Kind: ArchiveWriteFailureCreate, Err: errors.New("create failed")},
	})
	res := ExecuteArchive(ctx, map[string]any{"filePath": "missing/out.zip", "files": []any{"f1.txt"}})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error creating zip file")

	useArchiveWriter(t, &fakeArchiveFileWriter{
		err: ArchiveWriteError{Kind: ArchiveWriteFailureEntry, Err: errors.New("copy failed")},
	})
	res = ExecuteArchive(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error adding file to archive")

	useArchiveWriter(t, &fakeArchiveFileWriter{})
	res = ExecuteArchive(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "No files could be added")

	useArchiveWriter(t, &fakeArchiveFileWriter{
		err: ArchiveWriteError{Kind: ArchiveWriteFailureFinalize, Err: errors.New("close failed")},
	})
	res = ExecuteArchive(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error finalizing archive")

	useArchiveWriter(t, &fakeArchiveFileWriter{
		err: ArchiveWriteError{Kind: ArchiveWriteFailureFinalizeFile, Err: errors.New("close file failed")},
	})
	res = ExecuteArchive(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error finalizing archive file")

	useArchiveWriter(t, &fakeArchiveFileWriter{
		err: ArchiveWriteError{Kind: ArchiveWriteFailureSave, Err: errors.New("rename failed")},
	})
	res = ExecuteArchive(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error saving archive")

	res = ExecuteArchive(ctx, map[string]any{"filePath": "../out.zip", "files": []any{"f1.txt"}})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "external directory")

	writer := &fakeArchiveFileWriter{useEntryCount: true}
	useArchiveWriter(t, writer)
	res = ExecuteArchive(ctx, args)
	assert.Equal(t, "completed", res.Status)
	if assert.Len(t, writer.requests, 1) {
		assert.Equal(t, filepath.Join(tmpDir, "out.zip"), writer.requests[0].Path)
		assert.Len(t, writer.requests[0].Entries, 1)
	}
}

func TestGeneratedChartEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{
		"filePath": "chart.png",
		"data": []any{
			map[string]any{"label": "A", "value": 2},
		},
	}

	res := ExecuteChart(ctx, map[string]any{"filePath": "../chart.png", "data": args["data"]})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "external directory")

	useChartWriter(t, &fakeChartWriter{
		err: ChartWriteError{Kind: ChartWriteFailureDirectory, Err: errors.New("mkdir failed")},
	})
	res = ExecuteChart(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "mkdir failed")

	useChartWriter(t, &fakeChartWriter{
		err: ChartWriteError{Kind: ChartWriteFailureFile, Err: errors.New("create failed")},
	})
	res = ExecuteChart(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error creating chart file")

	res = ExecuteChart(ctx, map[string]any{"filePath": "empty.png", "data": []any{"skip"}})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "missing chart values")

	assert.Equal(t, 1.0, maxChartValue([]chartDatum{{Value: -1}}))
	assert.Equal(t, 1.0, sumChartValues([]chartDatum{{Value: 0}}))
}

func TestGeneratedPDFEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{
		"filePath": "report.pdf",
		"title":    "Report",
		"sections": []any{
			"skip",
			map[string]any{"heading": "Heading", "content": "Body"},
		},
	}

	res := ExecutePDF(ctx, map[string]any{"filePath": "../report.pdf", "sections": args["sections"]})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "external directory")

	usePDFWriter(t, &fakePDFWriter{})

	res = ExecutePDF(ctx, args)
	require.Equal(t, "completed", res.Status)
	assert.Equal(t, 2, res.Metadata["sections"])

	usePDFWriter(t, &fakePDFWriter{
		err: PDFWriteError{Kind: PDFWriteFailureDirectory, Err: errors.New("mkdir failed")},
	})
	res = ExecutePDF(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "mkdir failed")

	usePDFWriter(t, &fakePDFWriter{
		err: PDFWriteError{Kind: PDFWriteFailureFile, Err: errors.New("save failed")},
	})
	res = ExecutePDF(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error saving PDF")
}

func TestGeneratedSpreadsheetEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Cwd: tmpDir}
	args := map[string]any{
		"filePath": "diagnostics.xlsx",
		"sheets": []any{
			map[string]any{"rows": []any{[]any{"A"}}},
			map[string]any{"name": "bad/name", "rows": []any{[]any{"B"}}},
			map[string]any{"name": "NoRows"},
		},
	}

	previousCellName := spreadsheetCoordinatesToCellName
	useSpreadsheetWriter(t, &fakeSpreadsheetWriter{})
	t.Cleanup(func() {
		spreadsheetCoordinatesToCellName = previousCellName
	})

	spreadsheetCoordinatesToCellName = func(int, int, ...bool) (string, error) {
		return "", errors.New("bad coordinates")
	}
	res := ExecuteSpreadsheet(ctx, args)
	require.Equal(t, "completed", res.Status)
	cellErrors, ok := res.Metadata["cell_errors"].([]string)
	require.True(t, ok)
	assert.NotEmpty(t, cellErrors)
	assert.Contains(t, strings.Join(cellErrors, "\n"), "bad coordinates")
	assert.Contains(t, strings.Join(cellErrors, "\n"), "sheet 2 create")

	spreadsheetCoordinatesToCellName = previousCellName
	useSpreadsheetWriter(t, &fakeSpreadsheetWriter{err: errors.New("save failed")})
	res = ExecuteSpreadsheet(ctx, map[string]any{
		"filePath": "save-error.xlsx",
		"sheets":   []any{map[string]any{"rows": []any{[]any{"A"}}}},
	})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "Error saving spreadsheet")
}
