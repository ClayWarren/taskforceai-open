package artifacts

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

// ErrCSVWriterUnavailable is returned when no outer CSV writer is installed.
var ErrCSVWriterUnavailable = errors.New("csv writer unavailable")

// MaxCSVRows is the maximum number of rows allowed to prevent OOM.
const MaxCSVRows = MaxSpreadsheetRows

// MaxCSVColumns is the maximum number of cells allowed per row to prevent oversized allocations.
const MaxCSVColumns = 1000

// MaxCSVOutputBytes is the maximum encoded CSV size accepted by create_csv.
const MaxCSVOutputBytes = 10 * 1024 * 1024

// CSVWriteFailureKind identifies the concrete persistence step that failed.
type CSVWriteFailureKind string

const (
	CSVWriteFailureDirectory CSVWriteFailureKind = "directory"
	CSVWriteFailureFile      CSVWriteFailureKind = "file"
)

// CSVEncodeFailureKind identifies the concrete CSV encoding step that failed.
type CSVEncodeFailureKind string

const (
	CSVEncodeFailureRow   CSVEncodeFailureKind = "row"
	CSVEncodeFailureFlush CSVEncodeFailureKind = "flush"
	CSVEncodeFailureSize  CSVEncodeFailureKind = "size"
)

// CSVWriteError lets the outer writer preserve core-owned tool error wording.
type CSVWriteError struct {
	Kind CSVWriteFailureKind
	Err  error
}

func (e CSVWriteError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e CSVWriteError) Unwrap() error {
	return e.Err
}

// CSVEncodeError preserves CSV generation failures across the writer boundary.
type CSVEncodeError struct {
	Kind CSVEncodeFailureKind
	Err  error
}

func (e CSVEncodeError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e CSVEncodeError) Unwrap() error {
	return e.Err
}

// CSVWriteRequest is the generated CSV stream delegated to an outer writer.
type CSVWriteRequest struct {
	Path  string
	Write func(io.Writer) error
}

// CSVWriter persists a generated CSV stream outside the core package.
type CSVWriter interface {
	WriteCSV(context.Context, CSVWriteRequest) error
}

type emptyCSVWriter struct{}

func (emptyCSVWriter) WriteCSV(context.Context, CSVWriteRequest) error {
	return ErrCSVWriterUnavailable
}

type csvRecordWriter interface {
	Write([]string) error
	Flush()
	Error() error
}

func newCSVRecordWriter(w io.Writer) csvRecordWriter {
	return csv.NewWriter(w)
}

var csvWriters = runtimevalue.New[CSVWriter](emptyCSVWriter{})

var createCSVRecordWriter = newCSVRecordWriter

type csvSizeLimitWriter struct {
	dst     io.Writer
	limit   int64
	written int64
}

func newCSVSizeLimitWriter(dst io.Writer, limit int64) *csvSizeLimitWriter {
	return &csvSizeLimitWriter{dst: dst, limit: limit}
}

func (w *csvSizeLimitWriter) Write(p []byte) (int, error) {
	if w.limit > 0 && int64(len(p)) > w.limit-w.written {
		return 0, CSVEncodeError{
			Kind: CSVEncodeFailureSize,
			Err:  fmt.Errorf("CSV output exceeds maximum allowed (%d bytes)", w.limit),
		}
	}
	n, err := w.dst.Write(p)
	w.written += int64(n)
	return n, err
}

// SetCSVWriter installs the outer writer used by create_csv and returns a restore function.
func SetCSVWriter(writer CSVWriter) func() {
	return csvWriters.Set(writer)
}

func currentCSVWriter() CSVWriter {
	return csvWriters.Current()
}

func ExecuteCSV(ctx protocol.ToolContext, args map[string]any) (state protocol.ToolResult) {
	state = toolutil.NewResult(args)
	filePath := toolutil.GetString(args, "filePath")
	if filePath == "" {
		return toolutil.InvalidArgs("create_csv", args, "missing filePath")
	}

	rows, ok := args["rows"].([]any)
	if !ok || len(rows) == 0 {
		return toolutil.InvalidArgs("create_csv", args, "missing or empty rows")
	}
	if len(rows) > MaxCSVRows {
		state.Status = "error"
		state.Error = fmt.Sprintf("Row count (%d) exceeds maximum allowed (%d)", len(rows), MaxCSVRows)
		return state
	}
	for rowIndex, r := range rows {
		rowCells, ok := r.([]any)
		if !ok {
			continue
		}
		if len(rowCells) > MaxCSVColumns {
			state.Status = "error"
			state.Error = fmt.Sprintf("Row %d has %d cells, exceeds maximum allowed (%d)", rowIndex+1, len(rowCells), MaxCSVColumns)
			return state
		}
	}

	full, ok := filepolicy.PrepareFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	if err := currentCSVWriter().WriteCSV(ctx.Ctx, CSVWriteRequest{Path: full, Write: func(w io.Writer) error {
		return writeCSVRows(newCSVSizeLimitWriter(w, MaxCSVOutputBytes), rows)
	}}); err != nil {
		state.Status = "error"
		state.Error = csvWriteErrorMessage(err)
		return state
	}

	state.Output = fmt.Sprintf("CSV created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"filepath": filePath,
		"rows":     len(rows),
	}

	return state
}

func writeCSVRows(w io.Writer, rows []any) error {
	writer := createCSVRecordWriter(w)

	for _, r := range rows {
		rowCells, ok := r.([]any)
		if !ok {
			continue
		}

		record := make([]string, len(rowCells))
		for i, cell := range rowCells {
			record[i] = fmt.Sprint(cell)
		}

		if err := writer.Write(record); err != nil {
			return CSVEncodeError{Kind: CSVEncodeFailureRow, Err: err}
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		var encodeErr CSVEncodeError
		if errors.As(err, &encodeErr) {
			return encodeErr
		}
		return CSVEncodeError{Kind: CSVEncodeFailureFlush, Err: err}
	}
	return nil
}

func csvWriteErrorMessage(err error) string {
	var encodeErr CSVEncodeError
	if errors.As(err, &encodeErr) {
		switch encodeErr.Kind {
		case CSVEncodeFailureRow:
			return "Error writing CSV row: " + encodeErr.Error()
		case CSVEncodeFailureFlush:
			return "CSV flush failed: " + encodeErr.Error()
		case CSVEncodeFailureSize:
			return encodeErr.Error()
		}
	}
	var writeErr CSVWriteError
	if errors.As(err, &writeErr) {
		switch writeErr.Kind {
		case CSVWriteFailureDirectory:
			return "Error creating CSV directory: " + writeErr.Error()
		case CSVWriteFailureFile:
			return "Error creating CSV file: " + writeErr.Error()
		}
	}
	return "Error saving CSV file: " + err.Error()
}
