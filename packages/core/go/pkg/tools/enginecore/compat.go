// Package tools preserves the historical enginecore tool import path.
//
// New code should import github.com/TaskForceAI/core/pkg/enginecore/tools.
package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
)

const (
	MaxArchiveFiles       = enginecoretools.MaxArchiveFiles
	MaxCSVColumns         = enginecoretools.MaxCSVColumns
	MaxCSVOutputBytes     = enginecoretools.MaxCSVOutputBytes
	MaxCSVRows            = enginecoretools.MaxCSVRows
	MaxPresentationSlides = enginecoretools.MaxPresentationSlides
	MaxSpreadsheetRows    = enginecoretools.MaxSpreadsheetRows

	ArchiveWriteFailureCreate         = enginecoretools.ArchiveWriteFailureCreate
	ArchiveWriteFailureEntry          = enginecoretools.ArchiveWriteFailureEntry
	ArchiveWriteFailureFinalize       = enginecoretools.ArchiveWriteFailureFinalize
	ArchiveWriteFailureFinalizeFile   = enginecoretools.ArchiveWriteFailureFinalizeFile
	ArchiveWriteFailureSave           = enginecoretools.ArchiveWriteFailureSave
	CSVEncodeFailureRow               = enginecoretools.CSVEncodeFailureRow
	CSVEncodeFailureFlush             = enginecoretools.CSVEncodeFailureFlush
	CSVEncodeFailureSize              = enginecoretools.CSVEncodeFailureSize
	CSVWriteFailureDirectory          = enginecoretools.CSVWriteFailureDirectory
	CSVWriteFailureFile               = enginecoretools.CSVWriteFailureFile
	ChartWriteFailureDirectory        = enginecoretools.ChartWriteFailureDirectory
	ChartWriteFailureFile             = enginecoretools.ChartWriteFailureFile
	DocumentWriteFailureDirectory     = enginecoretools.DocumentWriteFailureDirectory
	DocumentWriteFailureFile          = enginecoretools.DocumentWriteFailureFile
	PDFWriteFailureDirectory          = enginecoretools.PDFWriteFailureDirectory
	PDFWriteFailureFile               = enginecoretools.PDFWriteFailureFile
	PresentationWriteFailureDirectory = enginecoretools.PresentationWriteFailureDirectory
	PresentationWriteFailureFile      = enginecoretools.PresentationWriteFailureFile
)

var (
	ErrArchiveWriterUnavailable      = enginecoretools.ErrArchiveWriterUnavailable
	ErrCSVWriterUnavailable          = enginecoretools.ErrCSVWriterUnavailable
	ErrChartWriterUnavailable        = enginecoretools.ErrChartWriterUnavailable
	ErrDocumentWriterUnavailable     = enginecoretools.ErrDocumentWriterUnavailable
	ErrPDFWriterUnavailable          = enginecoretools.ErrPDFWriterUnavailable
	ErrPresentationWriterUnavailable = enginecoretools.ErrPresentationWriterUnavailable
	ErrSiteWriterUnavailable         = enginecoretools.ErrSiteWriterUnavailable
	ErrSpreadsheetWriterUnavailable  = enginecoretools.ErrSpreadsheetWriterUnavailable
	ErrWebFetchConnection            = enginecoretools.ErrWebFetchConnection
	ErrWebFetchPrivateAddress        = enginecoretools.ErrWebFetchPrivateAddress
	ErrWebFetchSourceUnavailable     = enginecoretools.ErrWebFetchSourceUnavailable
)

type (
	ArchiveEntry                 = enginecoretools.ArchiveEntry
	ArchiveWriteError            = enginecoretools.ArchiveWriteError
	ArchiveWriteFailureKind      = enginecoretools.ArchiveWriteFailureKind
	ArchiveWriteRequest          = enginecoretools.ArchiveWriteRequest
	ArchiveWriteResult           = enginecoretools.ArchiveWriteResult
	ArchiveWriter                = enginecoretools.ArchiveWriter
	CSVEncodeError               = enginecoretools.CSVEncodeError
	CSVEncodeFailureKind         = enginecoretools.CSVEncodeFailureKind
	CSVWriteError                = enginecoretools.CSVWriteError
	CSVWriteFailureKind          = enginecoretools.CSVWriteFailureKind
	CSVWriteRequest              = enginecoretools.CSVWriteRequest
	CSVWriter                    = enginecoretools.CSVWriter
	ChartWriteError              = enginecoretools.ChartWriteError
	ChartWriteFailureKind        = enginecoretools.ChartWriteFailureKind
	ChartWriteRequest            = enginecoretools.ChartWriteRequest
	ChartWriter                  = enginecoretools.ChartWriter
	DocumentSection              = enginecoretools.DocumentSection
	DocumentWriteError           = enginecoretools.DocumentWriteError
	DocumentWriteFailureKind     = enginecoretools.DocumentWriteFailureKind
	DocumentWriteRequest         = enginecoretools.DocumentWriteRequest
	DocumentWriter               = enginecoretools.DocumentWriter
	PDFWriteError                = enginecoretools.PDFWriteError
	PDFWriteFailureKind          = enginecoretools.PDFWriteFailureKind
	PDFWriteRequest              = enginecoretools.PDFWriteRequest
	PDFWriter                    = enginecoretools.PDFWriter
	PresentationSlide            = enginecoretools.PresentationSlide
	PresentationWriteError       = enginecoretools.PresentationWriteError
	PresentationWriteFailureKind = enginecoretools.PresentationWriteFailureKind
	PresentationWriteRequest     = enginecoretools.PresentationWriteRequest
	PresentationWriter           = enginecoretools.PresentationWriter
	SiteWriteRequest             = enginecoretools.SiteWriteRequest
	SiteWriter                   = enginecoretools.SiteWriter
	SpreadsheetSheet             = enginecoretools.SpreadsheetSheet
	SpreadsheetWriteRequest      = enginecoretools.SpreadsheetWriteRequest
	SpreadsheetWriter            = enginecoretools.SpreadsheetWriter
	ToolResult                   = enginecoretools.ToolResult
	WebFetchRequest              = enginecoretools.WebFetchRequest
	WebFetchResponse             = enginecoretools.WebFetchResponse
	WebFetchSource               = enginecoretools.WebFetchSource
)

func ExecuteTool(ctx protocol.ToolContext, name string, args map[string]any) ToolResult {
	return enginecoretools.ExecuteTool(ctx, name, args)
}

func NewToolResult(args map[string]any) ToolResult { return enginecoretools.NewToolResult(args) }

func NewTodoStore() protocol.TodoStore { return enginecoretools.NewTodoStore() }

func CloneTodoStore(store protocol.TodoStore) protocol.TodoStore {
	return enginecoretools.CloneTodoStore(store)
}

func SetArchiveWriter(writer ArchiveWriter) func() {
	return enginecoretools.SetArchiveWriter(writer)
}

func SetCSVWriter(writer CSVWriter) func() { return enginecoretools.SetCSVWriter(writer) }

func SetChartWriter(writer ChartWriter) func() { return enginecoretools.SetChartWriter(writer) }

func SetDocumentWriter(writer DocumentWriter) func() {
	return enginecoretools.SetDocumentWriter(writer)
}

func SetPDFWriter(writer PDFWriter) func() { return enginecoretools.SetPDFWriter(writer) }

func SetPresentationWriter(writer PresentationWriter) func() {
	return enginecoretools.SetPresentationWriter(writer)
}

func SetSiteWriter(writer SiteWriter) func() { return enginecoretools.SetSiteWriter(writer) }

func SetSpreadsheetWriter(writer SpreadsheetWriter) func() {
	return enginecoretools.SetSpreadsheetWriter(writer)
}

func SetWebFetchSource(source WebFetchSource) func() {
	return enginecoretools.SetWebFetchSource(source)
}

func ToolRead(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolRead(ctx, args)
}

func ToolWrite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolWrite(ctx, args)
}

func ToolEdit(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolEdit(ctx, args)
}

func ToolGlob(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolGlob(ctx, args)
}

func ToolGrep(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolGrep(ctx, args)
}

func ToolCreateSpreadsheet(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreateSpreadsheet(ctx, args)
}

func ToolCreateDocument(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreateDocument(ctx, args)
}

func ToolCreatePresentation(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreatePresentation(ctx, args)
}

func ToolCreateArchive(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreateArchive(ctx, args)
}

func ToolCreateCSV(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreateCSV(ctx, args)
}

func ToolCreatePDF(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreatePDF(ctx, args)
}

func ToolCreateChart(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreateChart(ctx, args)
}

func ToolCreateSite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return enginecoretools.ToolCreateSite(ctx, args)
}
