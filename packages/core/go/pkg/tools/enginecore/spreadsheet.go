package tools

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// MaxSpreadsheetRows is the maximum number of rows allowed per sheet to prevent OOM.
const MaxSpreadsheetRows = 10000

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

func toolCreateSpreadsheet(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	filePath := getString(args, "filePath")
	if filePath == "" {
		return invalidArgs("create_spreadsheet", args, "missing filePath")
	}

	sheets, ok := args["sheets"].([]any)
	if !ok || len(sheets) == 0 {
		return invalidArgs("create_spreadsheet", args, "missing or empty sheets")
	}

	totalRows := spreadsheetRowCount(sheets)
	if totalRows > MaxSpreadsheetRows {
		state.Status = "error"
		state.Error = fmt.Sprintf("Total rows (%d) exceeds maximum allowed (%d)", totalRows, MaxSpreadsheetRows)
		return state
	}

	full, ok := prepareExternalFile(ctx, filePath, &state)
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

func spreadsheetRowCount(sheets []any) int {
	total := 0
	for _, rawSheet := range sheets {
		if sheet, ok := rawSheet.(map[string]any); ok {
			if rows, ok := sheet["rows"].([]any); ok {
				total += len(rows)
			}
		}
	}
	return total
}

func buildSpreadsheetSheets(sheets []any) ([]SpreadsheetSheet, []string) {
	var cellErrors []string
	result := make([]SpreadsheetSheet, 0, len(sheets))
	for i, s := range sheets {
		sheetMap, ok := s.(map[string]any)
		if !ok {
			continue
		}
		sheetName := getString(sheetMap, "name")
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
