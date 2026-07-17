package artifacts

import (
	"context"
	"errors"
	"fmt"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
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

var presentationWriters = runtimevalue.New[PresentationWriter](emptyPresentationWriter{})

// SetPresentationWriter installs the outer writer used by create_presentation and returns a restore function.
func SetPresentationWriter(writer PresentationWriter) func() {
	return presentationWriters.Set(writer)
}

func currentPresentationWriter() PresentationWriter {
	return presentationWriters.Current()
}

func ExecutePresentation(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	filePath := toolutil.GetString(args, "filePath")
	if filePath == "" {
		return toolutil.InvalidArgs("create_presentation", args, "missing filePath")
	}

	slides, ok := args["slides"].([]any)
	if !ok || len(slides) == 0 {
		return toolutil.InvalidArgs("create_presentation", args, "missing or empty slides")
	}

	// #26: Enforce upper bounds on slide count to prevent OOM
	if len(slides) > MaxPresentationSlides {
		state.Status = "error"
		state.Error = fmt.Sprintf("Slide count (%d) exceeds maximum allowed (%d)", len(slides), MaxPresentationSlides)
		return state
	}

	full, ok := filepolicy.PrepareFile(ctx, filePath, &state)
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
			Title: toolutil.GetString(slideMap, "title"),
			Body:  toolutil.GetString(slideMap, "body"),
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
