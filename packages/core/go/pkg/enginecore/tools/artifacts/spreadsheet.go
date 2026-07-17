package artifacts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

const (
	// MaxSpreadsheetRows is the maximum total number of rows allowed per workbook.
	MaxSpreadsheetRows = 10000
	// MaxSpreadsheetSheets is the maximum number of sheets allowed per workbook.
	MaxSpreadsheetSheets = 100
	// MaxSpreadsheetColumns is the maximum number of cells allowed per row.
	MaxSpreadsheetColumns = 1000
	// MaxSpreadsheetCells is the maximum total number of cells allowed per workbook.
	MaxSpreadsheetCells = 1_000_000
	// MaxSpreadsheetCellBytes is the maximum serialized size of one cell value.
	MaxSpreadsheetCellBytes = 1 * 1024 * 1024
	// MaxSpreadsheetPayloadBytes is the maximum serialized size of all cell values.
	MaxSpreadsheetPayloadBytes = 50 * 1024 * 1024
)

type spreadsheetSizeLimits struct {
	sheets       int
	rows         int
	columns      int
	cells        int
	cellBytes    int
	payloadBytes int64
}

var defaultSpreadsheetSizeLimits = spreadsheetSizeLimits{
	sheets:       MaxSpreadsheetSheets,
	rows:         MaxSpreadsheetRows,
	columns:      MaxSpreadsheetColumns,
	cells:        MaxSpreadsheetCells,
	cellBytes:    MaxSpreadsheetCellBytes,
	payloadBytes: MaxSpreadsheetPayloadBytes,
}

// ErrSpreadsheetWriterUnavailable is returned when no outer spreadsheet writer is installed.
var ErrSpreadsheetWriterUnavailable = errors.New("spreadsheet writer unavailable")

// SpreadsheetSheet is a normalized sheet delegated to an outer writer.
type SpreadsheetSheet struct {
	Name string
	Rows [][]any
}

// SpreadsheetWriteRequest is the generated workbook payload delegated to an outer writer.
type SpreadsheetWriteRequest struct {
	Path   string
	Sheets []SpreadsheetSheet
}

// SpreadsheetWriter persists generated workbook bytes outside the core package.
type SpreadsheetWriter interface {
	WriteSpreadsheet(context.Context, SpreadsheetWriteRequest) error
}

type emptySpreadsheetWriter struct{}

func (emptySpreadsheetWriter) WriteSpreadsheet(context.Context, SpreadsheetWriteRequest) error {
	return ErrSpreadsheetWriterUnavailable
}

var spreadsheetWriters = runtimevalue.New[SpreadsheetWriter](emptySpreadsheetWriter{})

var spreadsheetCoordinatesToCellName = spreadsheetColumnRowToCellName

// SetSpreadsheetWriter installs the outer writer used by create_spreadsheet and returns a restore function.
func SetSpreadsheetWriter(writer SpreadsheetWriter) func() {
	return spreadsheetWriters.Set(writer)
}

func currentSpreadsheetWriter() SpreadsheetWriter {
	return spreadsheetWriters.Current()
}

func ExecuteSpreadsheet(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	filePath := toolutil.GetString(args, "filePath")
	if filePath == "" {
		return toolutil.InvalidArgs("create_spreadsheet", args, "missing filePath")
	}

	sheets, ok := args["sheets"].([]any)
	if !ok || len(sheets) == 0 {
		return toolutil.InvalidArgs("create_spreadsheet", args, "missing or empty sheets")
	}

	if err := validateSpreadsheetSize(sheets); err != nil {
		state.Status = "error"
		state.Error = err.Error()
		return state
	}

	full, ok := filepolicy.PrepareFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	spreadsheetSheets, cellErrors := buildSpreadsheetSheets(sheets)

	if err := currentSpreadsheetWriter().WriteSpreadsheet(ctx.Ctx, SpreadsheetWriteRequest{Path: full, Sheets: spreadsheetSheets}); err != nil {
		state.Status = "error"
		state.Error = "Error saving spreadsheet: " + err.Error()
		return state
	}

	state.Output = fmt.Sprintf("Spreadsheet created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	metadata := map[string]any{"filepath": filePath, "sheets": len(sheets)}
	if len(cellErrors) > 0 {
		metadata["cell_errors"] = cellErrors
	}
	state.Metadata = metadata
	return state
}

func validateSpreadsheetSize(sheets []any) error {
	return validateSpreadsheetSizeWithLimits(sheets, defaultSpreadsheetSizeLimits)
}

func validateSpreadsheetSizeWithLimits(sheets []any, limits spreadsheetSizeLimits) error {
	if len(sheets) > limits.sheets {
		return fmt.Errorf("sheet count (%d) exceeds maximum allowed (%d)", len(sheets), limits.sheets)
	}

	totalRows := 0
	totalCells := 0
	var totalBytes int64
	for sheetIndex, rawSheet := range sheets {
		sheet, ok := rawSheet.(map[string]any)
		if !ok {
			continue
		}
		rows, ok := sheet["rows"].([]any)
		if !ok {
			continue
		}
		totalRows += len(rows)
		if totalRows > limits.rows {
			return fmt.Errorf("total rows (%d) exceeds maximum allowed (%d)", totalRows, limits.rows)
		}
		for rowIndex, rawRow := range rows {
			row, ok := rawRow.([]any)
			if !ok {
				continue
			}
			if len(row) > limits.columns {
				return fmt.Errorf("sheet %d row %d has %d cells, exceeds maximum allowed (%d)", sheetIndex+1, rowIndex+1, len(row), limits.columns)
			}
			totalCells += len(row)
			if totalCells > limits.cells {
				return fmt.Errorf("total cells (%d) exceeds maximum allowed (%d)", totalCells, limits.cells)
			}
			for columnIndex, cell := range row {
				encoded, err := json.Marshal(cell)
				if err != nil {
					return fmt.Errorf("sheet %d row %d col %d contains an unsupported value: %w", sheetIndex+1, rowIndex+1, columnIndex+1, err)
				}
				if len(encoded) > limits.cellBytes {
					return fmt.Errorf("sheet %d row %d col %d exceeds maximum serialized size (%d bytes)", sheetIndex+1, rowIndex+1, columnIndex+1, limits.cellBytes)
				}
				totalBytes += int64(len(encoded))
				if totalBytes > limits.payloadBytes {
					return fmt.Errorf("spreadsheet cell payload exceeds maximum serialized size (%d bytes)", limits.payloadBytes)
				}
			}
		}
	}
	return nil
}

func buildSpreadsheetSheets(sheets []any) ([]SpreadsheetSheet, []string) {
	var cellErrors []string
	result := make([]SpreadsheetSheet, 0, len(sheets))
	for i, s := range sheets {
		sheetMap, ok := s.(map[string]any)
		if !ok {
			continue
		}
		sheetName := toolutil.GetString(sheetMap, "name")
		if sheetName == "" {
			sheetName = fmt.Sprintf("Sheet%d", i+1)
		}

		if err := validateSpreadsheetSheetName(sheetName); err != nil {
			action := "create"
			if i == 0 {
				action = "rename"
			}
			cellErrors = append(cellErrors, fmt.Sprintf("sheet %d %s: %s", i+1, action, err.Error()))
		}

		sheet := SpreadsheetSheet{Name: sheetName}
		rows, ok := sheetMap["rows"].([]any)
		if !ok {
			result = append(result, sheet)
			continue
		}

		for rowIndex, r := range rows {
			rowCells, ok := r.([]any)
			if !ok {
				continue
			}
			row := make([]any, 0, len(rowCells))
			for colIndex, cellValue := range rowCells {
				cell, err := spreadsheetCoordinatesToCellName(colIndex+1, rowIndex+1)
				if err != nil {
					cellErrors = append(cellErrors, fmt.Sprintf("row %d col %d: %s", rowIndex+1, colIndex+1, err.Error()))
					continue
				}
				_ = cell
				row = append(row, cellValue)
			}
			sheet.Rows = append(sheet.Rows, row)
		}
		result = append(result, sheet)
	}
	return result, cellErrors
}

func spreadsheetColumnRowToCellName(col int, row int, _ ...bool) (string, error) {
	if col <= 0 || row <= 0 {
		return "", fmt.Errorf("invalid cell coordinates [%d, %d]", col, row)
	}
	var column strings.Builder
	for col > 0 {
		col--
		column.WriteByte(byte('A' + col%26))
		col /= 26
	}
	colName := []byte(column.String())
	for i, j := 0, len(colName)-1; i < j; i, j = i+1, j-1 {
		colName[i], colName[j] = colName[j], colName[i]
	}
	return string(colName) + strconv.Itoa(row), nil
}

func validateSpreadsheetSheetName(name string) error {
	if name == "" {
		return fmt.Errorf("sheet name is empty")
	}
	if len([]rune(name)) > 31 {
		return fmt.Errorf("sheet name %q exceeds 31 characters", name)
	}
	if strings.ContainsAny(name, `\/?*[]`) {
		return fmt.Errorf("sheet name %q contains invalid characters", name)
	}
	return nil
}
