package run

import (
	"context"
	"os"
	"path/filepath"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/jung-kurt/gofpdf"
)

type enginecoreFilePDFWriter struct{}

func (enginecoreFilePDFWriter) WritePDF(_ context.Context, request enginecoretools.PDFWriteRequest) error {
	if err := os.MkdirAll(filepath.Dir(request.Path), 0o750); err != nil {
		return enginecoretools.PDFWriteError{Kind: enginecoretools.PDFWriteFailureDirectory, Err: err}
	}
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	if request.Title != "" {
		pdf.SetFont("Arial", "B", 16)
		pdf.Cell(40, 10, request.Title)
		pdf.Ln(12)
	}

	for _, section := range request.Sections {
		if section.Heading != "" {
			pdf.SetFont("Arial", "B", 12)
			pdf.Cell(40, 10, section.Heading)
			pdf.Ln(8)
		}

		if section.Content != "" {
			pdf.SetFont("Arial", "", 11)
			pdf.MultiCell(0, 5, section.Content, "", "", false)
			pdf.Ln(6)
		}
	}

	if err := pdf.OutputFileAndClose(request.Path); err != nil {
		return enginecoretools.PDFWriteError{Kind: enginecoretools.PDFWriteFailureFile, Err: err}
	}
	return nil
}
