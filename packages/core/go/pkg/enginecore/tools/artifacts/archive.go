package artifacts

import (
	"context"
	"errors"
	"fmt"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/permissionpolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

// MaxArchiveFiles is the maximum number of files allowed in an archive to prevent OOM.
const MaxArchiveFiles = 100

// ErrArchiveWriterUnavailable is returned when no outer archive writer is installed.
var ErrArchiveWriterUnavailable = errors.New("archive writer unavailable")

// ArchiveWriteFailureKind identifies the concrete persistence step that failed.
type ArchiveWriteFailureKind string

const (
	ArchiveWriteFailureCreate       ArchiveWriteFailureKind = "create"
	ArchiveWriteFailureEntry        ArchiveWriteFailureKind = "entry"
	ArchiveWriteFailureFinalize     ArchiveWriteFailureKind = "finalize"
	ArchiveWriteFailureFinalizeFile ArchiveWriteFailureKind = "finalize_file"
	ArchiveWriteFailureSave         ArchiveWriteFailureKind = "save"
)

// ArchiveWriteError lets the outer writer preserve core-owned tool error wording.
type ArchiveWriteError struct {
	Kind ArchiveWriteFailureKind
	Err  error
}

func (e ArchiveWriteError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e ArchiveWriteError) Unwrap() error {
	return e.Err
}

// ArchiveEntry describes a source file approved by core policy for inclusion in an archive.
type ArchiveEntry struct {
	SourcePath string
	Name       string
}

// ArchiveWriteRequest is the generated archive payload delegated to an outer writer.
type ArchiveWriteRequest struct {
	Path    string
	Entries []ArchiveEntry
}

// ArchiveWriteResult reports how many approved entries were actually written.
type ArchiveWriteResult struct {
	FilesAdded int
}

// ArchiveWriter persists generated archive bytes outside the core package.
type ArchiveWriter interface {
	WriteArchive(context.Context, ArchiveWriteRequest) (ArchiveWriteResult, error)
}

type emptyArchiveWriter struct{}

func (emptyArchiveWriter) WriteArchive(context.Context, ArchiveWriteRequest) (ArchiveWriteResult, error) {
	return ArchiveWriteResult{}, ErrArchiveWriterUnavailable
}

var archiveWriters = runtimevalue.New[ArchiveWriter](emptyArchiveWriter{})

// SetArchiveWriter installs the outer writer used by create_archive and returns a restore function.
func SetArchiveWriter(writer ArchiveWriter) func() {
	return archiveWriters.Set(writer)
}

func currentArchiveWriter() ArchiveWriter {
	return archiveWriters.Current()
}

func ExecuteArchive(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	filePath := toolutil.GetString(args, "filePath")
	if filePath == "" {
		return toolutil.InvalidArgs("create_archive", args, "missing filePath")
	}

	files, ok := args["files"].([]any)
	if !ok || len(files) == 0 {
		return toolutil.InvalidArgs("create_archive", args, "missing or empty files list")
	}

	// #26: Enforce upper bounds on file count to prevent OOM.
	if len(files) > MaxArchiveFiles {
		state.Status = "error"
		state.Error = fmt.Sprintf("File count (%d) exceeds maximum allowed (%d)", len(files), MaxArchiveFiles)
		return state
	}

	fullZipPath, ok := filepolicy.PrepareFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	entries := make([]ArchiveEntry, 0, len(files))
	for _, f := range files {
		fileName, ok := f.(string)
		if !ok || fileName == "" {
			continue
		}

		if err := permissionpolicy.Ask(ctx, "read", map[string]any{"filePath": fileName}); err != nil {
			continue // Skip files without read permission.
		}

		fullFilePath, err := filepolicy.FilePath(ctx, fileName, filepolicy.File)
		if err != nil {
			continue // Skip files without external-directory permission.
		}

		entries = append(entries, ArchiveEntry{
			SourcePath: fullFilePath,
			Name:       filepolicy.BaseName(fileName),
		})
	}

	result, err := currentArchiveWriter().WriteArchive(ctx.Ctx, ArchiveWriteRequest{Path: fullZipPath, Entries: entries})
	if err != nil {
		state.Status = "error"
		state.Error = archiveWriteErrorMessage(err)
		return state
	}

	if result.FilesAdded == 0 {
		state.Status = "error"
		state.Error = "No files could be added to archive"
		return state
	}

	state.Output = fmt.Sprintf("Archive created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"filepath":        filePath,
		"files_requested": len(files),
		"files_added":     result.FilesAdded,
	}

	return state
}

func archiveWriteErrorMessage(err error) string {
	var writeErr ArchiveWriteError
	if errors.As(err, &writeErr) {
		switch writeErr.Kind {
		case ArchiveWriteFailureCreate:
			return "Error creating zip file: " + writeErr.Error()
		case ArchiveWriteFailureEntry:
			return "Error adding file to archive: " + writeErr.Error()
		case ArchiveWriteFailureFinalize:
			return "Error finalizing archive: " + writeErr.Error()
		case ArchiveWriteFailureFinalizeFile:
			return "Error finalizing archive file: " + writeErr.Error()
		case ArchiveWriteFailureSave:
			return "Error saving archive: " + writeErr.Error()
		}
	}
	return "Error saving archive: " + err.Error()
}
