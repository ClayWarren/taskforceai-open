package tools

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestWriterUnavailableAndNilBranches(t *testing.T) {
	ctx := context.Background()
	baseErr := errors.New("boom")
	t.Cleanup(func() {
		archiveWriterMu.Lock()
		archiveWriter = emptyArchiveWriter{}
		archiveWriterMu.Unlock()
		chartWriterMu.Lock()
		chartWriter = emptyChartWriter{}
		chartWriterMu.Unlock()
		csvWriterMu.Lock()
		csvWriter = emptyCSVWriter{}
		csvWriterMu.Unlock()
		documentWriterMu.Lock()
		documentWriter = emptyDocumentWriter{}
		documentWriterMu.Unlock()
		pdfWriterMu.Lock()
		pdfWriter = emptyPDFWriter{}
		pdfWriterMu.Unlock()
		presentationWriterMu.Lock()
		presentationWriter = emptyPresentationWriter{}
		presentationWriterMu.Unlock()
		siteWriterMu.Lock()
		siteWriter = emptySiteWriter{}
		siteWriterMu.Unlock()
		spreadsheetWriterMu.Lock()
		spreadsheetWriter = emptySpreadsheetWriter{}
		spreadsheetWriterMu.Unlock()
		webFetchSourceMu.Lock()
		webFetchSource = emptyWebFetchSource{}
		webFetchSourceMu.Unlock()
	})

	if got := (ArchiveWriteError{Kind: ArchiveWriteFailureSave}).Error(); got != string(ArchiveWriteFailureSave) {
		t.Fatalf("unexpected archive nil error text: %q", got)
	}
	if !errors.Is((ArchiveWriteError{Kind: ArchiveWriteFailureSave, Err: baseErr}).Unwrap(), baseErr) {
		t.Fatal("archive unwrap should expose base error")
	}
	if _, err := (emptyArchiveWriter{}).WriteArchive(ctx, ArchiveWriteRequest{}); !errors.Is(err, ErrArchiveWriterUnavailable) {
		t.Fatalf("expected archive unavailable, got %v", err)
	}
	restoreArchive := SetArchiveWriter(nil)
	_, err := currentArchiveWriter().WriteArchive(ctx, ArchiveWriteRequest{})
	if !errors.Is(err, ErrArchiveWriterUnavailable) {
		t.Fatalf("nil archive writer should install empty writer, got %v", err)
	}
	restoreArchive()
	archiveWriterMu.Lock()
	archiveWriter = nil
	archiveWriterMu.Unlock()
	_, err = currentArchiveWriter().WriteArchive(ctx, ArchiveWriteRequest{})
	if !errors.Is(err, ErrArchiveWriterUnavailable) {
		t.Fatalf("nil stored archive writer should resolve empty writer, got %v", err)
	}
	if got := archiveWriteErrorMessage(errors.New("plain")); got != "Error saving archive: plain" {
		t.Fatalf("unexpected archive fallback message: %q", got)
	}

	if got := (ChartWriteError{Kind: ChartWriteFailureFile}).Error(); got != string(ChartWriteFailureFile) {
		t.Fatalf("unexpected chart nil error text: %q", got)
	}
	if !errors.Is((ChartWriteError{Kind: ChartWriteFailureFile, Err: baseErr}).Unwrap(), baseErr) {
		t.Fatal("chart unwrap should expose base error")
	}
	if err := (emptyChartWriter{}).WriteChart(ctx, ChartWriteRequest{}); !errors.Is(err, ErrChartWriterUnavailable) {
		t.Fatalf("expected chart unavailable, got %v", err)
	}
	restoreChart := SetChartWriter(nil)
	if err := currentChartWriter().WriteChart(ctx, ChartWriteRequest{}); !errors.Is(err, ErrChartWriterUnavailable) {
		t.Fatalf("nil chart writer should install empty writer, got %v", err)
	}
	restoreChart()
	chartWriterMu.Lock()
	chartWriter = nil
	chartWriterMu.Unlock()
	if err := currentChartWriter().WriteChart(ctx, ChartWriteRequest{}); !errors.Is(err, ErrChartWriterUnavailable) {
		t.Fatalf("nil stored chart writer should resolve empty writer, got %v", err)
	}
	if got := chartWriteErrorMessage(errors.New("plain")); got != "Error saving chart: plain" {
		t.Fatalf("unexpected chart fallback message: %q", got)
	}

	if got := (CSVWriteError{Kind: CSVWriteFailureFile}).Error(); got != string(CSVWriteFailureFile) {
		t.Fatalf("unexpected csv write nil error text: %q", got)
	}
	if got := (CSVEncodeError{Kind: CSVEncodeFailureFlush}).Error(); got != string(CSVEncodeFailureFlush) {
		t.Fatalf("unexpected csv encode nil error text: %q", got)
	}
	if !errors.Is((CSVWriteError{Kind: CSVWriteFailureFile, Err: baseErr}).Unwrap(), baseErr) ||
		!errors.Is((CSVEncodeError{Kind: CSVEncodeFailureFlush, Err: baseErr}).Unwrap(), baseErr) {
		t.Fatal("csv unwrap should expose base errors")
	}
	if err := (emptyCSVWriter{}).WriteCSV(ctx, CSVWriteRequest{}); !errors.Is(err, ErrCSVWriterUnavailable) {
		t.Fatalf("expected csv unavailable, got %v", err)
	}
	restoreCSV := SetCSVWriter(nil)
	if err := currentCSVWriter().WriteCSV(ctx, CSVWriteRequest{}); !errors.Is(err, ErrCSVWriterUnavailable) {
		t.Fatalf("nil csv writer should install empty writer, got %v", err)
	}
	restoreCSV()
	csvWriterMu.Lock()
	csvWriter = nil
	csvWriterMu.Unlock()
	if err := currentCSVWriter().WriteCSV(ctx, CSVWriteRequest{}); !errors.Is(err, ErrCSVWriterUnavailable) {
		t.Fatalf("nil stored csv writer should resolve empty writer, got %v", err)
	}
	if got := csvWriteErrorMessage(errors.New("plain")); got != "Error saving CSV file: plain" {
		t.Fatalf("unexpected csv fallback message: %q", got)
	}

	if got := (DocumentWriteError{Kind: DocumentWriteFailureFile}).Error(); got != string(DocumentWriteFailureFile) {
		t.Fatalf("unexpected document nil error text: %q", got)
	}
	if !errors.Is((DocumentWriteError{Kind: DocumentWriteFailureFile, Err: baseErr}).Unwrap(), baseErr) {
		t.Fatal("document unwrap should expose base error")
	}
	if err := (emptyDocumentWriter{}).WriteDocument(ctx, DocumentWriteRequest{}); !errors.Is(err, ErrDocumentWriterUnavailable) {
		t.Fatalf("expected document unavailable, got %v", err)
	}
	restoreDocument := SetDocumentWriter(nil)
	if err := currentDocumentWriter().WriteDocument(ctx, DocumentWriteRequest{}); !errors.Is(err, ErrDocumentWriterUnavailable) {
		t.Fatalf("nil document writer should install empty writer, got %v", err)
	}
	restoreDocument()
	documentWriterMu.Lock()
	documentWriter = nil
	documentWriterMu.Unlock()
	if err := currentDocumentWriter().WriteDocument(ctx, DocumentWriteRequest{}); !errors.Is(err, ErrDocumentWriterUnavailable) {
		t.Fatalf("nil stored document writer should resolve empty writer, got %v", err)
	}
	if got := documentWriteErrorMessage(errors.New("plain")); got != "Error saving document: plain" {
		t.Fatalf("unexpected document fallback message: %q", got)
	}

	if got := (PDFWriteError{Kind: PDFWriteFailureFile}).Error(); got != string(PDFWriteFailureFile) {
		t.Fatalf("unexpected pdf nil error text: %q", got)
	}
	if !errors.Is((PDFWriteError{Kind: PDFWriteFailureFile, Err: baseErr}).Unwrap(), baseErr) {
		t.Fatal("pdf unwrap should expose base error")
	}
	if err := (emptyPDFWriter{}).WritePDF(ctx, PDFWriteRequest{}); !errors.Is(err, ErrPDFWriterUnavailable) {
		t.Fatalf("expected pdf unavailable, got %v", err)
	}
	restorePDF := SetPDFWriter(nil)
	if err := currentPDFWriter().WritePDF(ctx, PDFWriteRequest{}); !errors.Is(err, ErrPDFWriterUnavailable) {
		t.Fatalf("nil pdf writer should install empty writer, got %v", err)
	}
	restorePDF()
	pdfWriterMu.Lock()
	pdfWriter = nil
	pdfWriterMu.Unlock()
	if err := currentPDFWriter().WritePDF(ctx, PDFWriteRequest{}); !errors.Is(err, ErrPDFWriterUnavailable) {
		t.Fatalf("nil stored pdf writer should resolve empty writer, got %v", err)
	}
	if got := pdfWriteErrorMessage(errors.New("plain")); got != "Error saving PDF: plain" {
		t.Fatalf("unexpected pdf fallback message: %q", got)
	}

	if got := (PresentationWriteError{Kind: PresentationWriteFailureFile}).Error(); got != string(PresentationWriteFailureFile) {
		t.Fatalf("unexpected presentation nil error text: %q", got)
	}
	if !errors.Is((PresentationWriteError{Kind: PresentationWriteFailureFile, Err: baseErr}).Unwrap(), baseErr) {
		t.Fatal("presentation unwrap should expose base error")
	}
	if err := (emptyPresentationWriter{}).WritePresentation(ctx, PresentationWriteRequest{}); !errors.Is(err, ErrPresentationWriterUnavailable) {
		t.Fatalf("expected presentation unavailable, got %v", err)
	}
	restorePresentation := SetPresentationWriter(nil)
	if err := currentPresentationWriter().WritePresentation(ctx, PresentationWriteRequest{}); !errors.Is(err, ErrPresentationWriterUnavailable) {
		t.Fatalf("nil presentation writer should install empty writer, got %v", err)
	}
	restorePresentation()
	presentationWriterMu.Lock()
	presentationWriter = nil
	presentationWriterMu.Unlock()
	if err := currentPresentationWriter().WritePresentation(ctx, PresentationWriteRequest{}); !errors.Is(err, ErrPresentationWriterUnavailable) {
		t.Fatalf("nil stored presentation writer should resolve empty writer, got %v", err)
	}
	if got := presentationWriteErrorMessage(errors.New("plain")); got != "Error saving presentation: plain" {
		t.Fatalf("unexpected presentation fallback message: %q", got)
	}

	if err := (emptySiteWriter{}).WriteSite(ctx, SiteWriteRequest{}); !errors.Is(err, ErrSiteWriterUnavailable) {
		t.Fatalf("expected site unavailable, got %v", err)
	}
	restoreSite := SetSiteWriter(nil)
	if err := currentSiteWriter().WriteSite(ctx, SiteWriteRequest{}); !errors.Is(err, ErrSiteWriterUnavailable) {
		t.Fatalf("nil site writer should install empty writer, got %v", err)
	}
	restoreSite()
	siteWriterMu.Lock()
	siteWriter = nil
	siteWriterMu.Unlock()
	if err := currentSiteWriter().WriteSite(ctx, SiteWriteRequest{}); !errors.Is(err, ErrSiteWriterUnavailable) {
		t.Fatalf("nil stored site writer should resolve empty writer, got %v", err)
	}

	if err := (emptySpreadsheetWriter{}).WriteSpreadsheet(ctx, SpreadsheetWriteRequest{}); !errors.Is(err, ErrSpreadsheetWriterUnavailable) {
		t.Fatalf("expected spreadsheet unavailable, got %v", err)
	}
	restoreSpreadsheet := SetSpreadsheetWriter(nil)
	if err := currentSpreadsheetWriter().WriteSpreadsheet(ctx, SpreadsheetWriteRequest{}); !errors.Is(err, ErrSpreadsheetWriterUnavailable) {
		t.Fatalf("nil spreadsheet writer should install empty writer, got %v", err)
	}
	restoreSpreadsheet()
	spreadsheetWriterMu.Lock()
	spreadsheetWriter = nil
	spreadsheetWriterMu.Unlock()
	if err := currentSpreadsheetWriter().WriteSpreadsheet(ctx, SpreadsheetWriteRequest{}); !errors.Is(err, ErrSpreadsheetWriterUnavailable) {
		t.Fatalf("nil stored spreadsheet writer should resolve empty writer, got %v", err)
	}

	if _, err := (emptyWebFetchSource{}).Fetch(ctx, WebFetchRequest{}); !errors.Is(err, ErrWebFetchSourceUnavailable) {
		t.Fatalf("expected webfetch unavailable, got %v", err)
	}
	restoreWebFetch := SetWebFetchSource(nil)
	if _, err := currentWebFetchSource().Fetch(ctx, WebFetchRequest{}); !errors.Is(err, ErrWebFetchSourceUnavailable) {
		t.Fatalf("nil webfetch source should install empty source, got %v", err)
	}
	restoreWebFetch()
	webFetchSourceMu.Lock()
	webFetchSource = nil
	webFetchSourceMu.Unlock()
	if _, err := currentWebFetchSource().Fetch(ctx, WebFetchRequest{}); !errors.Is(err, ErrWebFetchSourceUnavailable) {
		t.Fatalf("nil stored webfetch source should resolve empty source, got %v", err)
	}
}

func TestSpreadsheetHelperEdgeBranches(t *testing.T) {
	if _, err := spreadsheetColumnRowToCellName(0, 1); err == nil {
		t.Fatal("expected invalid column error")
	}
	if got, err := spreadsheetColumnRowToCellName(28, 2); err != nil || got != "AB2" {
		t.Fatalf("expected AB2, got %q err=%v", got, err)
	}
	if err := validateSpreadsheetSheetName(""); err == nil {
		t.Fatal("expected empty sheet name error")
	}
	if err := validateSpreadsheetSheetName(strings.Repeat("a", 32)); err == nil {
		t.Fatal("expected long sheet name error")
	}
	if err := validateSpreadsheetSheetName("bad/name"); err == nil {
		t.Fatal("expected invalid character sheet name error")
	}
}
