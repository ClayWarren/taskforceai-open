package artifacts

import (
	"context"
	"errors"

	"github.com/TaskForceAI/core/internal/runtimevalue"
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

var pdfWriters = runtimevalue.New[PDFWriter](emptyPDFWriter{})

// SetPDFWriter installs the outer writer used by create_pdf and returns a restore function.
func SetPDFWriter(writer PDFWriter) func() {
	return pdfWriters.Set(writer)
}

func currentPDFWriter() PDFWriter {
	return pdfWriters.Current()
}

func writePDF(ctx context.Context, path, title string, sections []DocumentSection) error {
	return currentPDFWriter().WritePDF(ctx, PDFWriteRequest{Path: path, Title: title, Sections: sections})
}

func ExecutePDF(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	return executeSectionedFile(ctx, args, "create_pdf", "PDF", writePDF, pdfWriteErrorMessage)
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
