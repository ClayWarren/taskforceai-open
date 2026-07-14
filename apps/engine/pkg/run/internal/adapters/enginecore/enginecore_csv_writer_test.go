package enginecoreadapter

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreFileCSVWriter(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "reports", "data.csv")

	err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
		Path: target,
		Write: func(w io.Writer) error {
			_, err := w.Write([]byte("name,value\nalpha,1\n"))
			return err
		},
	})
	require.NoError(t, err)

	created, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "name,value\nalpha,1\n", string(created))
}

func TestEnginecoreFileCSVWriterPreservesDestinationOnStreamError(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "reports", "data.csv")
	original := []byte("original\n")
	require.NoError(t, os.MkdirAll(filepath.Dir(target), 0o750))
	require.NoError(t, os.WriteFile(target, original, 0o600))

	err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
		Path: target,
		Write: func(w io.Writer) error {
			if _, writeErr := w.Write([]byte("partial\n")); writeErr != nil {
				return writeErr
			}
			return errors.New("encode failed")
		},
	})
	require.Error(t, err)

	created, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, original, created)
}

func TestEnginecoreFileCSVWriterErrorBranches(t *testing.T) {
	t.Run("directory error", func(t *testing.T) {
		tmpDir := t.TempDir()
		blocker := filepath.Join(tmpDir, "blocked")
		require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

		err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
			Path:  filepath.Join(blocker, "data.csv"),
			Write: func(io.Writer) error { return nil },
		})
		var writeErr enginecoretools.CSVWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.CSVWriteFailureDirectory, writeErr.Kind)
	})

	t.Run("nil writer", func(t *testing.T) {
		err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
			Path: filepath.Join(t.TempDir(), "data.csv"),
		})
		var writeErr enginecoretools.CSVWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.CSVWriteFailureFile, writeErr.Kind)
	})

	t.Run("create temp error", func(t *testing.T) {
		originalCreate := createEnginecoreCSVTempFile
		t.Cleanup(func() { createEnginecoreCSVTempFile = originalCreate })
		createEnginecoreCSVTempFile = func(string, string) (*os.File, error) {
			return nil, errors.New("create failed")
		}

		err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
			Path:  filepath.Join(t.TempDir(), "data.csv"),
			Write: func(io.Writer) error { return nil },
		})
		var writeErr enginecoretools.CSVWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.CSVWriteFailureFile, writeErr.Kind)
	})

	t.Run("close error", func(t *testing.T) {
		originalClose := closeEnginecoreCSVTempFile
		t.Cleanup(func() { closeEnginecoreCSVTempFile = originalClose })
		closeEnginecoreCSVTempFile = func(*os.File) error {
			return errors.New("close failed")
		}

		err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
			Path:  filepath.Join(t.TempDir(), "data.csv"),
			Write: func(io.Writer) error { return nil },
		})
		var writeErr enginecoretools.CSVWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.CSVWriteFailureFile, writeErr.Kind)
	})

	t.Run("chmod error", func(t *testing.T) {
		originalChmod := chmodEnginecoreCSVTempFile
		t.Cleanup(func() { chmodEnginecoreCSVTempFile = originalChmod })
		chmodEnginecoreCSVTempFile = func(string, os.FileMode) error {
			return errors.New("chmod failed")
		}

		err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
			Path:  filepath.Join(t.TempDir(), "data.csv"),
			Write: func(io.Writer) error { return nil },
		})
		var writeErr enginecoretools.CSVWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.CSVWriteFailureFile, writeErr.Kind)
	})

	t.Run("rename error", func(t *testing.T) {
		originalRename := renameEnginecoreCSVTempFile
		t.Cleanup(func() { renameEnginecoreCSVTempFile = originalRename })
		renameEnginecoreCSVTempFile = func(string, string) error {
			return errors.New("rename failed")
		}

		err := (enginecoreFileCSVWriter{}).WriteCSV(context.Background(), enginecoretools.CSVWriteRequest{
			Path:  filepath.Join(t.TempDir(), "data.csv"),
			Write: func(io.Writer) error { return nil },
		})
		var writeErr enginecoretools.CSVWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.CSVWriteFailureFile, writeErr.Kind)
	})
}
