package enginecoreadapter

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

func TestEnginecoreFileSpreadsheetWriter(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "reports", "data.xlsx")

	err := (enginecoreFileSpreadsheetWriter{}).WriteSpreadsheet(context.Background(), enginecoretools.SpreadsheetWriteRequest{
		Path: target,
		Sheets: []enginecoretools.SpreadsheetSheet{
			{Name: "Sheet1", Rows: [][]any{{"Report"}}},
		},
	})
	require.NoError(t, err)
	assert.FileExists(t, target)
}

func TestEnginecoreFileSpreadsheetWriterErrorAndSkipBranches(t *testing.T) {
	t.Run("directory error", func(t *testing.T) {
		blocker := filepath.Join(t.TempDir(), "blocked")
		require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

		err := (enginecoreFileSpreadsheetWriter{}).WriteSpreadsheet(context.Background(), enginecoretools.SpreadsheetWriteRequest{
			Path: filepath.Join(blocker, "data.xlsx"),
		})
		require.Error(t, err)
	})

	t.Run("invalid and duplicate sheets are skipped", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "data.xlsx")
		err := (enginecoreFileSpreadsheetWriter{}).WriteSpreadsheet(context.Background(), enginecoretools.SpreadsheetWriteRequest{
			Path: target,
			Sheets: []enginecoretools.SpreadsheetSheet{
				{Name: "bad/name", Rows: [][]any{{"skipped"}}},
				{Name: "Data", Rows: [][]any{{"ok"}}},
				{Name: "Data", Rows: [][]any{{"duplicate"}}},
				{Name: "", Rows: [][]any{{"default"}}},
			},
		})
		require.NoError(t, err)
		assert.FileExists(t, target)
	})

	t.Run("cell name error is skipped", func(t *testing.T) {
		originalCellName := enginecoreSpreadsheetCellName
		t.Cleanup(func() { enginecoreSpreadsheetCellName = originalCellName })
		enginecoreSpreadsheetCellName = func(int, int, ...bool) (string, error) {
			return "", errors.New("cell failed")
		}

		err := (enginecoreFileSpreadsheetWriter{}).WriteSpreadsheet(context.Background(), enginecoretools.SpreadsheetWriteRequest{
			Path: filepath.Join(t.TempDir(), "data.xlsx"),
			Sheets: []enginecoretools.SpreadsheetSheet{
				{Name: "Data", Rows: [][]any{{"skipped"}}},
			},
		})
		require.NoError(t, err)
	})

	t.Run("new sheet error is skipped", func(t *testing.T) {
		originalNewSheet := newEnginecoreSpreadsheetSheet
		t.Cleanup(func() { newEnginecoreSpreadsheetSheet = originalNewSheet })
		newEnginecoreSpreadsheetSheet = func(workbook *excelize.File, name string) (int, error) {
			return 0, errors.New("sheet failed")
		}

		err := (enginecoreFileSpreadsheetWriter{}).WriteSpreadsheet(context.Background(), enginecoretools.SpreadsheetWriteRequest{
			Path: filepath.Join(t.TempDir(), "data.xlsx"),
			Sheets: []enginecoretools.SpreadsheetSheet{
				{Name: "Data", Rows: [][]any{{"ok"}}},
				{Name: "Other", Rows: [][]any{{"skipped"}}},
			},
		})
		require.NoError(t, err)
	})

	t.Run("save error", func(t *testing.T) {
		target := filepath.Join(t.TempDir(), "data.xlsx")
		require.NoError(t, os.Mkdir(target, 0o750))

		err := (enginecoreFileSpreadsheetWriter{}).WriteSpreadsheet(context.Background(), enginecoretools.SpreadsheetWriteRequest{
			Path: target,
		})
		require.Error(t, err)
	})
}
