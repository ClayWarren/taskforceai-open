package artifacts

import (
	"context"
	"errors"
	"fmt"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

// ErrDocumentWriterUnavailable is returned when no outer document writer is installed.
var ErrDocumentWriterUnavailable = errors.New("document writer unavailable")

// DocumentWriteFailureKind identifies the concrete persistence step that failed.
type DocumentWriteFailureKind string

const (
	DocumentWriteFailureDirectory DocumentWriteFailureKind = "directory"
	DocumentWriteFailureFile      DocumentWriteFailureKind = "file"
)

// DocumentWriteError lets the outer writer preserve core-owned tool error wording.
type DocumentWriteError struct {
	Kind DocumentWriteFailureKind
	Err  error
}

func (e DocumentWriteError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e DocumentWriteError) Unwrap() error {
	return e.Err
}

// DocumentSection is a normalized document section delegated to an outer writer.
type DocumentSection struct {
	Heading string
	Content string
}

// DocumentWriteRequest is the generated document payload delegated to an outer writer.
type DocumentWriteRequest struct {
	Path     string
	Title    string
	Sections []DocumentSection
}

// DocumentWriter persists generated document bytes outside the core package.
type DocumentWriter interface {
	WriteDocument(context.Context, DocumentWriteRequest) error
}

type emptyDocumentWriter struct{}

func (emptyDocumentWriter) WriteDocument(context.Context, DocumentWriteRequest) error {
	return ErrDocumentWriterUnavailable
}

var documentWriters = runtimevalue.New[DocumentWriter](emptyDocumentWriter{})

// SetDocumentWriter installs the outer writer used by create_document and returns a restore function.
func SetDocumentWriter(writer DocumentWriter) func() {
	return documentWriters.Set(writer)
}

func currentDocumentWriter() DocumentWriter {
	return documentWriters.Current()
}

func writeDocument(ctx context.Context, path, title string, sections []DocumentSection) error {
	return currentDocumentWriter().WriteDocument(ctx, DocumentWriteRequest{Path: path, Title: title, Sections: sections})
}

func ExecuteDocument(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	return executeSectionedFile(ctx, args, "create_document", "Document", writeDocument, documentWriteErrorMessage)
}

func executeSectionedFile(
	ctx protocol.ToolContext,
	args map[string]any,
	toolName, label string,
	write func(context.Context, string, string, []DocumentSection) error,
	errorMessage func(error) string,
) protocol.ToolResult {
	state := toolutil.NewResult(args)
	filePath := toolutil.GetString(args, "filePath")
	if filePath == "" {
		return toolutil.InvalidArgs(toolName, args, "missing filePath")
	}

	title := toolutil.GetString(args, "title")
	sections, ok := args["sections"].([]any)
	if !ok || len(sections) == 0 {
		return toolutil.InvalidArgs(toolName, args, "missing or empty sections")
	}

	full, ok := filepolicy.PrepareFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	documentSections := make([]DocumentSection, 0, len(sections))
	for _, s := range sections {
		sectionMap, ok := s.(map[string]any)
		if !ok {
			continue
		}
		documentSections = append(documentSections, DocumentSection{
			Heading: toolutil.GetString(sectionMap, "heading"),
			Content: toolutil.GetString(sectionMap, "content"),
		})
	}

	if err := write(ctx.Ctx, full, title, documentSections); err != nil {
		state.Status = "error"
		state.Error = errorMessage(err)
		return state
	}

	state.Output = fmt.Sprintf("%s created successfully at %s", label, filePath)
	state.Title = filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"filepath": filePath,
		"sections": len(sections),
	}

	return state
}

func documentWriteErrorMessage(err error) string {
	var writeErr DocumentWriteError
	if errors.As(err, &writeErr) {
		switch writeErr.Kind {
		case DocumentWriteFailureDirectory:
			return "Error: " + writeErr.Error()
		case DocumentWriteFailureFile:
			return "Error saving document: " + writeErr.Error()
		}
	}
	return "Error saving document: " + err.Error()
}
