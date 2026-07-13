package run

import (
	"context"
	"os"
	"path/filepath"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/unidoc/unioffice/presentation"
)

type enginecoreFilePresentationWriter struct{}

var saveEnginecorePresentationToFile = func(ppt *presentation.Presentation, path string) error {
	return ppt.SaveToFile(path)
}

func (enginecoreFilePresentationWriter) WritePresentation(_ context.Context, request enginecoretools.PresentationWriteRequest) error {
	if err := os.MkdirAll(filepath.Dir(request.Path), 0o750); err != nil {
		return enginecoretools.PresentationWriteError{Kind: enginecoretools.PresentationWriteFailureDirectory, Err: err}
	}
	ppt := presentation.New()
	defer func() {
		_ = ppt.Close()
	}()

	for _, requestSlide := range request.Slides {
		slide := ppt.AddSlide()

		if requestSlide.Title != "" {
			tb := slide.AddTextBox()
			tb.AddParagraph().AddRun().SetText(requestSlide.Title)
		}

		if requestSlide.Body != "" {
			tb := slide.AddTextBox()
			tb.AddParagraph().AddRun().SetText(requestSlide.Body)
		}
	}

	if err := saveEnginecorePresentationToFile(ppt, request.Path); err != nil {
		return enginecoretools.PresentationWriteError{Kind: enginecoretools.PresentationWriteFailureFile, Err: err}
	}
	return nil
}
