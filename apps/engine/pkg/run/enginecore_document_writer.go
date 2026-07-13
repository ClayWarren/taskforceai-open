package run

import (
	"context"
	"os"
	"path/filepath"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/unidoc/unioffice/document"
)

type enginecoreFileDocumentWriter struct{}

var saveEnginecoreDocumentToFile = func(doc *document.Document, path string) error {
	return doc.SaveToFile(path)
}

func (enginecoreFileDocumentWriter) WriteDocument(_ context.Context, request enginecoretools.DocumentWriteRequest) error {
	if err := os.MkdirAll(filepath.Dir(request.Path), 0o750); err != nil {
		return enginecoretools.DocumentWriteError{Kind: enginecoretools.DocumentWriteFailureDirectory, Err: err}
	}
	doc := document.New()
	defer func() {
		_ = doc.Close()
	}()

	if request.Title != "" {
		para := doc.AddParagraph()
		run := para.AddRun()
		run.Properties().SetBold(true)
		run.Properties().SetSize(24)
		run.AddText(request.Title)
	}

	for _, section := range request.Sections {
		if section.Heading != "" {
			para := doc.AddParagraph()
			run := para.AddRun()
			run.Properties().SetBold(true)
			run.Properties().SetSize(16)
			run.AddText(section.Heading)
		}

		if section.Content != "" {
			para := doc.AddParagraph()
			run := para.AddRun()
			run.AddText(section.Content)
		}
	}

	if err := saveEnginecoreDocumentToFile(doc, request.Path); err != nil {
		return enginecoretools.DocumentWriteError{Kind: enginecoretools.DocumentWriteFailureFile, Err: err}
	}
	return nil
}
