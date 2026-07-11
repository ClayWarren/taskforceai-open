package tools

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// MaxPresentationSlides is the maximum number of slides allowed to prevent OOM.
const MaxPresentationSlides = 100

// ErrPresentationWriterUnavailable is returned when no outer presentation writer is installed.
var ErrPresentationWriterUnavailable = errors.New("presentation writer unavailable")

// PresentationWriteFailureKind identifies the concrete persistence step that failed.
type PresentationWriteFailureKind string

const (
	PresentationWriteFailureDirectory PresentationWriteFailureKind = "directory"
	PresentationWriteFailureFile      PresentationWriteFailureKind = "file"
)

// PresentationWriteError lets the outer writer preserve core-owned tool error wording.
type PresentationWriteError struct {
	Kind PresentationWriteFailureKind
	Err  error
}

func (e PresentationWriteError) Error() string {
	if e.Err == nil {
		return string(e.Kind)
	}
	return e.Err.Error()
}

func (e PresentationWriteError) Unwrap() error {
	return e.Err
}

// PresentationSlide is a normalized slide delegated to an outer writer.
type PresentationSlide struct {
	Title string
	Body  string
}

// PresentationWriteRequest is the generated presentation payload delegated to an outer writer.
type PresentationWriteRequest struct {
	Path   string
	Slides []PresentationSlide
}

// PresentationWriter persists generated presentation bytes outside the core package.
type PresentationWriter interface {
	WritePresentation(context.Context, PresentationWriteRequest) error
}

type emptyPresentationWriter struct{}

func (emptyPresentationWriter) WritePresentation(context.Context, PresentationWriteRequest) error {
	return ErrPresentationWriterUnavailable
}

var (
	presentationWriterMu sync.RWMutex
	presentationWriter   PresentationWriter = emptyPresentationWriter{}
)

// SetPresentationWriter installs the outer writer used by create_presentation and returns a restore function.
func SetPresentationWriter(writer PresentationWriter) func() {
	if writer == nil {
		writer = emptyPresentationWriter{}
	}

	presentationWriterMu.Lock()
	previous := presentationWriter
	presentationWriter = writer
	presentationWriterMu.Unlock()

	return func() {
		presentationWriterMu.Lock()
		presentationWriter = previous
		presentationWriterMu.Unlock()
	}
}

func currentPresentationWriter() PresentationWriter {
	presentationWriterMu.RLock()
	writer := presentationWriter
	presentationWriterMu.RUnlock()
	if writer == nil {
		return emptyPresentationWriter{}
	}
	return writer
}

func toolCreatePresentation(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	filePath := getString(args, "filePath")
	if filePath == "" {
		return invalidArgs("create_presentation", args, "missing filePath")
	}

	slides, ok := args["slides"].([]any)
	if !ok || len(slides) == 0 {
		return invalidArgs("create_presentation", args, "missing or empty slides")
	}

	// #26: Enforce upper bounds on slide count to prevent OOM
	if len(slides) > MaxPresentationSlides {
		state.Status = "error"
		state.Error = fmt.Sprintf("Slide count (%d) exceeds maximum allowed (%d)", len(slides), MaxPresentationSlides)
		return state
	}

	full, ok := prepareExternalFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	presentationSlides := make([]PresentationSlide, 0, len(slides))
	for _, s := range slides {
		slideMap, ok := s.(map[string]any)
		if !ok {
			continue
		}
		presentationSlides = append(presentationSlides, PresentationSlide{
			Title: getString(slideMap, "title"),
			Body:  getString(slideMap, "body"),
		})
	}

	if err := currentPresentationWriter().WritePresentation(ctx.Ctx, PresentationWriteRequest{Path: full, Slides: presentationSlides}); err != nil {
		state.Status = "error"
		state.Error = presentationWriteErrorMessage(err)
		return state
	}

	state.Output = fmt.Sprintf("Presentation created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"filepath": filePath,
		"slides":   len(slides),
	}

	return state
}

func presentationWriteErrorMessage(err error) string {
	var writeErr PresentationWriteError
	if errors.As(err, &writeErr) {
		switch writeErr.Kind {
		case PresentationWriteFailureDirectory:
			return "Error: " + writeErr.Error()
		case PresentationWriteFailureFile:
			return "Error saving presentation: " + writeErr.Error()
		}
	}
	return "Error saving presentation: " + err.Error()
}
