package run

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/xuri/excelize/v2"
)

type enginecoreFileSpreadsheetWriter struct{}

var (
	enginecoreSpreadsheetWriterMu        sync.Mutex
	enginecoreSpreadsheetWriterInstalled bool

	mkdirAllEnginecoreSpreadsheetDir = os.MkdirAll
	newEnginecoreSpreadsheetFile     = excelize.NewFile
	enginecoreSpreadsheetCellName    = excelize.CoordinatesToCellName
	newEnginecoreSpreadsheetSheet    = func(workbook *excelize.File, name string) (int, error) {
		return workbook.NewSheet(name)
	}
)

func installEnginecoreSpreadsheetWriter() {
	enginecoreSpreadsheetWriterMu.Lock()
	defer enginecoreSpreadsheetWriterMu.Unlock()
	if enginecoreSpreadsheetWriterInstalled {
		return
	}
	enginecoretools.SetSpreadsheetWriter(enginecoreFileSpreadsheetWriter{})
	enginecoreSpreadsheetWriterInstalled = true
}

func (enginecoreFileSpreadsheetWriter) WriteSpreadsheet(_ context.Context, request enginecoretools.SpreadsheetWriteRequest) error {
	if err := mkdirAllEnginecoreSpreadsheetDir(filepath.Dir(request.Path), 0o750); err != nil {
		return err
	}
	workbook := newEnginecoreSpreadsheetFile()
	defer func() {
		_ = workbook.Close()
	}()

	for i, sheet := range request.Sheets {
		sheetName := sheet.Name
		if sheetName == "" {
			sheetName = "Sheet1"
		}

		if i == 0 {
			if err := workbook.SetSheetName("Sheet1", sheetName); err != nil {
				continue
			}
		} else {
			if _, err := newEnginecoreSpreadsheetSheet(workbook, sheetName); err != nil {
				continue
			}
		}

		for rowIndex, row := range sheet.Rows {
			for colIndex, cellValue := range row {
				cell, err := enginecoreSpreadsheetCellName(colIndex+1, rowIndex+1)
				if err != nil {
					continue
				}
				_ = workbook.SetCellValue(sheetName, cell, cellValue)
			}
		}
	}

	return workbook.SaveAs(request.Path)
}
