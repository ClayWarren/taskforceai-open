package enginecoreadapter

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
)

type enginecoreFileCSVWriter struct{}

var (
	mkdirAllEnginecoreCSVTempDir = os.MkdirAll
	createEnginecoreCSVTempFile  = os.CreateTemp
	chmodEnginecoreCSVTempFile   = os.Chmod
	renameEnginecoreCSVTempFile  = os.Rename
	closeEnginecoreCSVTempFile   = func(file *os.File) error { return file.Close() }
)

func (enginecoreFileCSVWriter) WriteCSV(_ context.Context, request enginecoretools.CSVWriteRequest) error {
	if err := mkdirAllEnginecoreCSVTempDir(filepath.Dir(request.Path), 0o750); err != nil {
		return enginecoretools.CSVWriteError{Kind: enginecoretools.CSVWriteFailureDirectory, Err: err}
	}
	if request.Write == nil {
		return enginecoretools.CSVWriteError{Kind: enginecoretools.CSVWriteFailureFile, Err: errors.New("csv stream writer unavailable")}
	}

	tmpFile, err := createEnginecoreCSVTempFile(filepath.Dir(request.Path), filepath.Base(request.Path)+".tmp-*") // #nosec G304
	if err != nil {
		return enginecoretools.CSVWriteError{Kind: enginecoretools.CSVWriteFailureFile, Err: err}
	}
	tmpPath := tmpFile.Name()
	keepTemp := true
	defer func() {
		_ = closeEnginecoreCSVTempFile(tmpFile)
		if keepTemp {
			_ = os.Remove(tmpPath)
		}
	}()

	if err := request.Write(tmpFile); err != nil {
		return err
	}
	if err := closeEnginecoreCSVTempFile(tmpFile); err != nil {
		return enginecoretools.CSVWriteError{Kind: enginecoretools.CSVWriteFailureFile, Err: err}
	}
	if err := chmodEnginecoreCSVTempFile(tmpPath, 0o600); err != nil {
		return enginecoretools.CSVWriteError{Kind: enginecoretools.CSVWriteFailureFile, Err: err}
	}
	if err := renameEnginecoreCSVTempFile(tmpPath, request.Path); err != nil {
		return enginecoretools.CSVWriteError{Kind: enginecoretools.CSVWriteFailureFile, Err: err}
	}
	keepTemp = false

	return nil
}
