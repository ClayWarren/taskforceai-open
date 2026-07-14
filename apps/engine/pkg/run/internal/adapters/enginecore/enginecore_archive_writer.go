package enginecoreadapter

import (
	"archive/zip"
	"context"
	"io"
	"os"
	"path/filepath"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
)

type enginecoreFileArchiveWriter struct{}

type enginecoreArchiveZipWriter interface {
	CreateHeader(*zip.FileHeader) (io.Writer, error)
	Close() error
}

func newEnginecoreArchiveZipWriter(w io.Writer) enginecoreArchiveZipWriter {
	return zip.NewWriter(w)
}

func closeEnginecoreArchiveFile(file *os.File) error {
	return file.Close()
}

var (
	createEnginecoreArchiveTempFile = os.CreateTemp
	openEnginecoreArchiveFile       = os.Open
	statEnginecoreArchiveFile       = func(file *os.File) (os.FileInfo, error) { return file.Stat() }
	enginecoreArchiveFileInfoHeader = zip.FileInfoHeader
	newEnginecoreArchiveWriter      = newEnginecoreArchiveZipWriter
	copyEnginecoreArchiveFile       = io.Copy
	closeEnginecoreArchiveTempFile  = closeEnginecoreArchiveFile
	renameEnginecoreArchiveFile     = os.Rename
)

func (enginecoreFileArchiveWriter) WriteArchive(_ context.Context, request enginecoretools.ArchiveWriteRequest) (enginecoretools.ArchiveWriteResult, error) {
	tmpZipFile, err := createEnginecoreArchiveTempFile(filepath.Dir(request.Path), filepath.Base(request.Path)+".tmp-*") // #nosec G304
	if err != nil {
		return enginecoretools.ArchiveWriteResult{}, enginecoretools.ArchiveWriteError{Kind: enginecoretools.ArchiveWriteFailureCreate, Err: err}
	}
	tmpZipPath := tmpZipFile.Name()
	keepTemp := true
	defer func() {
		_ = closeEnginecoreArchiveTempFile(tmpZipFile)
		if keepTemp {
			_ = os.Remove(tmpZipPath)
		}
	}()

	zipWriter := newEnginecoreArchiveWriter(tmpZipFile)
	successCount := 0
	for _, entry := range request.Entries {
		if entry.SourcePath == "" || entry.Name == "" {
			continue
		}
		fileToZip, err := openEnginecoreArchiveFile(entry.SourcePath) // #nosec G304
		if err != nil {
			continue
		}

		info, err := statEnginecoreArchiveFile(fileToZip)
		if err != nil {
			_ = fileToZip.Close()
			continue
		}

		header, err := enginecoreArchiveFileInfoHeader(info)
		if err != nil {
			_ = fileToZip.Close()
			continue
		}
		header.Name = entry.Name
		header.Method = zip.Deflate

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			_ = fileToZip.Close()
			continue
		}

		_, err = copyEnginecoreArchiveFile(writer, fileToZip)
		_ = fileToZip.Close()
		if err != nil {
			return enginecoretools.ArchiveWriteResult{}, enginecoretools.ArchiveWriteError{
				Kind: enginecoretools.ArchiveWriteFailureEntry,
				Err:  err,
			}
		}
		successCount++
	}

	if err := zipWriter.Close(); err != nil {
		return enginecoretools.ArchiveWriteResult{}, enginecoretools.ArchiveWriteError{Kind: enginecoretools.ArchiveWriteFailureFinalize, Err: err}
	}
	if successCount == 0 {
		return enginecoretools.ArchiveWriteResult{}, nil
	}
	if err := closeEnginecoreArchiveTempFile(tmpZipFile); err != nil {
		return enginecoretools.ArchiveWriteResult{}, enginecoretools.ArchiveWriteError{Kind: enginecoretools.ArchiveWriteFailureFinalizeFile, Err: err}
	}
	if err := renameEnginecoreArchiveFile(tmpZipPath, request.Path); err != nil {
		return enginecoretools.ArchiveWriteResult{}, enginecoretools.ArchiveWriteError{Kind: enginecoretools.ArchiveWriteFailureSave, Err: err}
	}
	keepTemp = false

	return enginecoretools.ArchiveWriteResult{FilesAdded: successCount}, nil
}
