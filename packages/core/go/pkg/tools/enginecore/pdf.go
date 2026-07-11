package tools

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// ErrPDFWriterUnavailable is returned when no outer PDF writer is installed.
var ErrPDFWriterUnavailable = errors.New("pdf writer unavailable")

// PDFWriteFailureKind identifies the concrete persistence step that failed.
type PDFWriteFailureKind string

const (
	PDFWriteFailureDirectory PDFWriteFailureKind = "directory"
	PDFWriteFailureFile      PDFWriteFailureKind = "file"
)

// PDFWriteError lets the outer writer preserve core-owned tool error wording.
type PDFWriteError struct {
	Kind PDFWriteFailureKind
	Err  error
}

func (e PDFWriteError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e PDFWriteError) Unwrap() error {
	return e.Err
}

// PDFWriteRequest is the generated PDF payload delegated to an outer writer.
type PDFWriteRequest struct {
	Path     string
	Title    string
	Sections []DocumentSection
}

// PDFWriter persists generated PDF bytes outside the core package.
type PDFWriter interface {
	WritePDF(context.Context, PDFWriteRequest) error
}

type emptyPDFWriter struct{}

func (emptyPDFWriter) WritePDF(context.Context, PDFWriteRequest) error {
	return ErrPDFWriterUnavailable
}

var (
	pdfWriterMu sync.RWMutex
	pdfWriter   PDFWriter = emptyPDFWriter{}
)

// SetPDFWriter installs the outer writer used by create_pdf and returns a restore function.
func SetPDFWriter(writer PDFWriter) func() {
	if writer == nil {
		writer = emptyPDFWriter{}
	}

	pdfWriterMu.Lock()
	previous := pdfWriter
	pdfWriter = writer
	pdfWriterMu.Unlock()

	return func() {
		pdfWriterMu.Lock()
		pdfWriter = previous
		pdfWriterMu.Unlock()
	}
}

func currentPDFWriter() PDFWriter {
	pdfWriterMu.RLock()
	writer := pdfWriter
	pdfWriterMu.RUnlock()
	if writer == nil {
		return emptyPDFWriter{}
	}
	return writer
}

func toolCreatePDF(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	filePath := getString(args, "filePath")
	if filePath == "" {
		return invalidArgs("create_pdf", args, "missing filePath")
	}

	title := getString(args, "title")
	sections, ok := args["sections"].([]any)
	if !ok || len(sections) == 0 {
		return invalidArgs("create_pdf", args, "missing or empty sections")
	}

	full, ok := prepareExternalFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	pdfSections := make([]DocumentSection, 0, len(sections))
	for _, s := range sections {
		sectionMap, ok := s.(map[string]any)
		if !ok {
			continue
		}
		pdfSections = append(pdfSections, DocumentSection{
			Heading: getString(sectionMap, "heading"),
			Content: getString(sectionMap, "content"),
		})
	}

	if err := currentPDFWriter().WritePDF(ctx.Ctx, PDFWriteRequest{
		Path:     full,
		Title:    title,
		Sections: pdfSections,
	}); err != nil {
		state.Status = "error"
		state.Error = pdfWriteErrorMessage(err)
		return state
	}

	state.Output = fmt.Sprintf("PDF created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"filepath": filePath,
		"sections": len(sections),
	}

	return state
}

func pdfWriteErrorMessage(err error) string {
	var writeErr PDFWriteError
	if errors.As(err, &writeErr) {
		switch writeErr.Kind {
		case PDFWriteFailureDirectory:
			return "Error: " + writeErr.Error()
		case PDFWriteFailureFile:
			return "Error saving PDF: " + writeErr.Error()
		}
	}
	return "Error saving PDF: " + err.Error()
}
