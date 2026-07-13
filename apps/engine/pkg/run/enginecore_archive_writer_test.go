package run

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeEnginecoreArchiveZipWriter struct {
	createErr error
	closeErr  error
}

func (f fakeEnginecoreArchiveZipWriter) CreateHeader(*zip.FileHeader) (io.Writer, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	return io.Discard, nil
}

func (f fakeEnginecoreArchiveZipWriter) Close() error {
	return f.closeErr
}

func TestEnginecoreFileArchiveWriter(t *testing.T) {
	tmpDir := t.TempDir()
	source := filepath.Join(tmpDir, "data.txt")
	require.NoError(t, os.WriteFile(source, []byte("report"), 0o600))
	target := filepath.Join(tmpDir, "bundle.zip")

	result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
		Path: target,
		Entries: []enginecoretools.ArchiveEntry{
			{SourcePath: source, Name: "data.txt"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, 1, result.FilesAdded)
	assert.FileExists(t, target)

	reader, err := zip.OpenReader(target)
	require.NoError(t, err)
	t.Cleanup(func() { _ = reader.Close() })
	if assert.Len(t, reader.File, 1) {
		assert.Equal(t, "data.txt", reader.File[0].Name)
	}
}

func TestEnginecoreFileArchiveWriterSkipsInvalidAndFailedEntries(t *testing.T) {
	t.Run("invalid entries", func(t *testing.T) {
		tmpDir := t.TempDir()
		target := filepath.Join(tmpDir, "bundle.zip")

		result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path: target,
			Entries: []enginecoretools.ArchiveEntry{
				{SourcePath: "", Name: "missing.txt"},
				{SourcePath: filepath.Join(tmpDir, "missing.txt"), Name: ""},
			},
		})
		require.NoError(t, err)
		assert.Zero(t, result.FilesAdded)
	})

	t.Run("stat error", func(t *testing.T) {
		originalStat := statEnginecoreArchiveFile
		t.Cleanup(func() { statEnginecoreArchiveFile = originalStat })
		statEnginecoreArchiveFile = func(*os.File) (os.FileInfo, error) {
			return nil, errors.New("stat failed")
		}

		source := filepath.Join(t.TempDir(), "data.txt")
		require.NoError(t, os.WriteFile(source, []byte("data"), 0o600))
		result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path: filepath.Join(t.TempDir(), "bundle.zip"),
			Entries: []enginecoretools.ArchiveEntry{
				{SourcePath: source, Name: "data.txt"},
			},
		})
		require.NoError(t, err)
		assert.Zero(t, result.FilesAdded)
	})

	t.Run("header error", func(t *testing.T) {
		originalHeader := enginecoreArchiveFileInfoHeader
		t.Cleanup(func() { enginecoreArchiveFileInfoHeader = originalHeader })
		enginecoreArchiveFileInfoHeader = func(os.FileInfo) (*zip.FileHeader, error) {
			return nil, errors.New("header failed")
		}

		source := filepath.Join(t.TempDir(), "data.txt")
		require.NoError(t, os.WriteFile(source, []byte("data"), 0o600))
		result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path: filepath.Join(t.TempDir(), "bundle.zip"),
			Entries: []enginecoretools.ArchiveEntry{
				{SourcePath: source, Name: "data.txt"},
			},
		})
		require.NoError(t, err)
		assert.Zero(t, result.FilesAdded)
	})

	t.Run("create header error", func(t *testing.T) {
		originalWriter := newEnginecoreArchiveWriter
		t.Cleanup(func() { newEnginecoreArchiveWriter = originalWriter })
		newEnginecoreArchiveWriter = func(io.Writer) enginecoreArchiveZipWriter {
			return fakeEnginecoreArchiveZipWriter{createErr: errors.New("create header failed")}
		}

		source := filepath.Join(t.TempDir(), "data.txt")
		require.NoError(t, os.WriteFile(source, []byte("data"), 0o600))
		result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path: filepath.Join(t.TempDir(), "bundle.zip"),
			Entries: []enginecoretools.ArchiveEntry{
				{SourcePath: source, Name: "data.txt"},
			},
		})
		require.NoError(t, err)
		assert.Zero(t, result.FilesAdded)
	})

	t.Run("copy error", func(t *testing.T) {
		originalCopy := copyEnginecoreArchiveFile
		t.Cleanup(func() { copyEnginecoreArchiveFile = originalCopy })
		copyEnginecoreArchiveFile = func(io.Writer, io.Reader) (int64, error) {
			return 0, errors.New("copy failed")
		}

		source := filepath.Join(t.TempDir(), "data.txt")
		require.NoError(t, os.WriteFile(source, []byte("data"), 0o600))
		result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path: filepath.Join(t.TempDir(), "bundle.zip"),
			Entries: []enginecoretools.ArchiveEntry{
				{SourcePath: source, Name: "data.txt"},
			},
		})
		var writeErr enginecoretools.ArchiveWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.ArchiveWriteFailureEntry, writeErr.Kind)
		assert.Zero(t, result.FilesAdded)
	})
}

func TestEnginecoreFileArchiveWriterFinalizeErrors(t *testing.T) {
	t.Run("zip close error", func(t *testing.T) {
		originalWriter := newEnginecoreArchiveWriter
		t.Cleanup(func() { newEnginecoreArchiveWriter = originalWriter })
		newEnginecoreArchiveWriter = func(io.Writer) enginecoreArchiveZipWriter {
			return fakeEnginecoreArchiveZipWriter{closeErr: errors.New("close failed")}
		}

		_, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path:    filepath.Join(t.TempDir(), "bundle.zip"),
			Entries: nil,
		})
		var writeErr enginecoretools.ArchiveWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.ArchiveWriteFailureFinalize, writeErr.Kind)
	})

	t.Run("temp close error", func(t *testing.T) {
		originalClose := closeEnginecoreArchiveTempFile
		t.Cleanup(func() { closeEnginecoreArchiveTempFile = originalClose })
		closeEnginecoreArchiveTempFile = func(*os.File) error {
			return errors.New("close failed")
		}

		source := filepath.Join(t.TempDir(), "data.txt")
		require.NoError(t, os.WriteFile(source, []byte("data"), 0o600))
		_, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
			Path: filepath.Join(t.TempDir(), "bundle.zip"),
			Entries: []enginecoretools.ArchiveEntry{
				{SourcePath: source, Name: "data.txt"},
			},
		})
		var writeErr enginecoretools.ArchiveWriteError
		require.ErrorAs(t, err, &writeErr)
		assert.Equal(t, enginecoretools.ArchiveWriteFailureFinalizeFile, writeErr.Kind)
	})
}

func TestEnginecoreFileArchiveWriterPreservesDestinationWhenNoFilesAdded(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "bundle.zip")
	original := []byte("ORIGINAL-DATA")
	require.NoError(t, os.WriteFile(target, original, 0o600))

	result, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
		Path: target,
		Entries: []enginecoretools.ArchiveEntry{
			{SourcePath: filepath.Join(tmpDir, "missing.txt"), Name: "missing.txt"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, 0, result.FilesAdded)
	after, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, original, after)
}

func TestEnginecoreFileArchiveWriterCreateError(t *testing.T) {
	tmpDir := t.TempDir()
	blocker := filepath.Join(tmpDir, "blocked")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

	_, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
		Path: filepath.Join(blocker, "bundle.zip"),
	})
	var writeErr enginecoretools.ArchiveWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.ArchiveWriteFailureCreate, writeErr.Kind)
}

func TestEnginecoreFileArchiveWriterSaveError(t *testing.T) {
	tmpDir := t.TempDir()
	source := filepath.Join(tmpDir, "data.txt")
	require.NoError(t, os.WriteFile(source, []byte("report"), 0o600))
	target := filepath.Join(tmpDir, "bundle.zip")
	require.NoError(t, os.Mkdir(target, 0o750))

	_, err := (enginecoreFileArchiveWriter{}).WriteArchive(context.Background(), enginecoretools.ArchiveWriteRequest{
		Path: target,
		Entries: []enginecoretools.ArchiveEntry{
			{SourcePath: source, Name: "data.txt"},
		},
	})
	var writeErr enginecoretools.ArchiveWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.ArchiveWriteFailureSave, writeErr.Kind)
}
