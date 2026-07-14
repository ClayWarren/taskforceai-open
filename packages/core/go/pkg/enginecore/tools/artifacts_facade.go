package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/artifacts"
)

const (
	MaxArchiveFiles       = artifacts.MaxArchiveFiles
	MaxCSVColumns         = artifacts.MaxCSVColumns
	MaxCSVOutputBytes     = artifacts.MaxCSVOutputBytes
	MaxCSVRows            = artifacts.MaxCSVRows
	MaxPresentationSlides = artifacts.MaxPresentationSlides
	MaxSpreadsheetRows    = artifacts.MaxSpreadsheetRows

	ArchiveWriteFailureCreate         = artifacts.ArchiveWriteFailureCreate
	ArchiveWriteFailureEntry          = artifacts.ArchiveWriteFailureEntry
	ArchiveWriteFailureFinalize       = artifacts.ArchiveWriteFailureFinalize
	ArchiveWriteFailureFinalizeFile   = artifacts.ArchiveWriteFailureFinalizeFile
	ArchiveWriteFailureSave           = artifacts.ArchiveWriteFailureSave
	CSVEncodeFailureRow               = artifacts.CSVEncodeFailureRow
	CSVEncodeFailureFlush             = artifacts.CSVEncodeFailureFlush
	CSVEncodeFailureSize              = artifacts.CSVEncodeFailureSize
	CSVWriteFailureDirectory          = artifacts.CSVWriteFailureDirectory
	CSVWriteFailureFile               = artifacts.CSVWriteFailureFile
	ChartWriteFailureDirectory        = artifacts.ChartWriteFailureDirectory
	ChartWriteFailureFile             = artifacts.ChartWriteFailureFile
	DocumentWriteFailureDirectory     = artifacts.DocumentWriteFailureDirectory
	DocumentWriteFailureFile          = artifacts.DocumentWriteFailureFile
	PDFWriteFailureDirectory          = artifacts.PDFWriteFailureDirectory
	PDFWriteFailureFile               = artifacts.PDFWriteFailureFile
	PresentationWriteFailureDirectory = artifacts.PresentationWriteFailureDirectory
	PresentationWriteFailureFile      = artifacts.PresentationWriteFailureFile
)

var (
	ErrArchiveWriterUnavailable      = artifacts.ErrArchiveWriterUnavailable
	ErrCSVWriterUnavailable          = artifacts.ErrCSVWriterUnavailable
	ErrChartWriterUnavailable        = artifacts.ErrChartWriterUnavailable
	ErrDocumentWriterUnavailable     = artifacts.ErrDocumentWriterUnavailable
	ErrPDFWriterUnavailable          = artifacts.ErrPDFWriterUnavailable
	ErrPresentationWriterUnavailable = artifacts.ErrPresentationWriterUnavailable
	ErrSiteWriterUnavailable         = artifacts.ErrSiteWriterUnavailable
	ErrSpreadsheetWriterUnavailable  = artifacts.ErrSpreadsheetWriterUnavailable
)

type (
	ArchiveEntry                 = artifacts.ArchiveEntry
	ArchiveWriteError            = artifacts.ArchiveWriteError
	ArchiveWriteFailureKind      = artifacts.ArchiveWriteFailureKind
	ArchiveWriteRequest          = artifacts.ArchiveWriteRequest
	ArchiveWriteResult           = artifacts.ArchiveWriteResult
	ArchiveWriter                = artifacts.ArchiveWriter
	CSVEncodeError               = artifacts.CSVEncodeError
	CSVEncodeFailureKind         = artifacts.CSVEncodeFailureKind
	CSVWriteError                = artifacts.CSVWriteError
	CSVWriteFailureKind          = artifacts.CSVWriteFailureKind
	CSVWriteRequest              = artifacts.CSVWriteRequest
	CSVWriter                    = artifacts.CSVWriter
	ChartWriteError              = artifacts.ChartWriteError
	ChartWriteFailureKind        = artifacts.ChartWriteFailureKind
	ChartWriteRequest            = artifacts.ChartWriteRequest
	ChartWriter                  = artifacts.ChartWriter
	DocumentSection              = artifacts.DocumentSection
	DocumentWriteError           = artifacts.DocumentWriteError
	DocumentWriteFailureKind     = artifacts.DocumentWriteFailureKind
	DocumentWriteRequest         = artifacts.DocumentWriteRequest
	DocumentWriter               = artifacts.DocumentWriter
	PDFWriteError                = artifacts.PDFWriteError
	PDFWriteFailureKind          = artifacts.PDFWriteFailureKind
	PDFWriteRequest              = artifacts.PDFWriteRequest
	PDFWriter                    = artifacts.PDFWriter
	PresentationSlide            = artifacts.PresentationSlide
	PresentationWriteError       = artifacts.PresentationWriteError
	PresentationWriteFailureKind = artifacts.PresentationWriteFailureKind
	PresentationWriteRequest     = artifacts.PresentationWriteRequest
	PresentationWriter           = artifacts.PresentationWriter
	SiteWriteRequest             = artifacts.SiteWriteRequest
	SiteWriter                   = artifacts.SiteWriter
	SpreadsheetSheet             = artifacts.SpreadsheetSheet
	SpreadsheetWriteRequest      = artifacts.SpreadsheetWriteRequest
	SpreadsheetWriter            = artifacts.SpreadsheetWriter
)

func SetArchiveWriter(writer ArchiveWriter) func() { return artifacts.SetArchiveWriter(writer) }

func SetCSVWriter(writer CSVWriter) func() { return artifacts.SetCSVWriter(writer) }

func SetChartWriter(writer ChartWriter) func() { return artifacts.SetChartWriter(writer) }

func SetDocumentWriter(writer DocumentWriter) func() { return artifacts.SetDocumentWriter(writer) }

func SetPDFWriter(writer PDFWriter) func() { return artifacts.SetPDFWriter(writer) }

func SetPresentationWriter(writer PresentationWriter) func() {
	return artifacts.SetPresentationWriter(writer)
}

func SetSiteWriter(writer SiteWriter) func() { return artifacts.SetSiteWriter(writer) }

func SetSpreadsheetWriter(writer SpreadsheetWriter) func() {
	return artifacts.SetSpreadsheetWriter(writer)
}

func toolCreateArchive(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecuteArchive(ctx, args)
}

func toolCreateCSV(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecuteCSV(ctx, args)
}

func toolCreateChart(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecuteChart(ctx, args)
}

func toolCreateDocument(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecuteDocument(ctx, args)
}

func toolCreatePDF(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecutePDF(ctx, args)
}

func toolCreatePresentation(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecutePresentation(ctx, args)
}

func toolCreateSite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecuteSite(ctx, args)
}

func toolCreateSpreadsheet(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return artifacts.ExecuteSpreadsheet(ctx, args)
}
