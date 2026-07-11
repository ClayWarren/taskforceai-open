package tools

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
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

var (
	documentWriterMu sync.RWMutex
	documentWriter   DocumentWriter = emptyDocumentWriter{}
)

// SetDocumentWriter installs the outer writer used by create_document and returns a restore function.
func SetDocumentWriter(writer DocumentWriter) func() {
	if writer == nil {
		writer = emptyDocumentWriter{}
	}

	documentWriterMu.Lock()
	previous := documentWriter
	documentWriter = writer
	documentWriterMu.Unlock()

	return func() {
		documentWriterMu.Lock()
		documentWriter = previous
		documentWriterMu.Unlock()
	}
}

func currentDocumentWriter() DocumentWriter {
	documentWriterMu.RLock()
	writer := documentWriter
	documentWriterMu.RUnlock()
	if writer == nil {
		return emptyDocumentWriter{}
	}
	return writer
}

func toolCreateDocument(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	filePath := getString(args, "filePath")
	if filePath == "" {
		return invalidArgs("create_document", args, "missing filePath")
	}

	title := getString(args, "title")
	sections, ok := args["sections"].([]any)
	if !ok || len(sections) == 0 {
		return invalidArgs("create_document", args, "missing or empty sections")
	}

	full, ok := prepareExternalFile(ctx, filePath, &state)
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
			Heading: getString(sectionMap, "heading"),
			Content: getString(sectionMap, "content"),
		})
	}

	if err := currentDocumentWriter().WriteDocument(ctx.Ctx, DocumentWriteRequest{
		Path:     full,
		Title:    title,
		Sections: documentSections,
	}); err != nil {
		state.Status = "error"
		state.Error = documentWriteErrorMessage(err)
		return state
	}

	state.Output = fmt.Sprintf("Document created successfully at %s", filePath)
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
