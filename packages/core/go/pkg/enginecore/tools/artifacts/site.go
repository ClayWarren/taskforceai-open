package artifacts

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

// ErrSiteWriterUnavailable is returned when no outer site writer is installed.
var ErrSiteWriterUnavailable = errors.New("site writer unavailable")

// SiteWriteRequest is the generated site payload delegated to an outer writer.
type SiteWriteRequest struct {
	Path    string
	Content []byte
}

// SiteWriter persists generated site bytes outside the core package.
type SiteWriter interface {
	WriteSite(context.Context, SiteWriteRequest) error
}

type emptySiteWriter struct{}

func (emptySiteWriter) WriteSite(context.Context, SiteWriteRequest) error {
	return ErrSiteWriterUnavailable
}

var siteWriters = runtimevalue.New[SiteWriter](emptySiteWriter{})

// SetSiteWriter installs the outer writer used by create_site and returns a restore function.
func SetSiteWriter(writer SiteWriter) func() {
	return siteWriters.Set(writer)
}

func currentSiteWriter() SiteWriter {
	return siteWriters.Current()
}

func ExecuteSite(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	filePath := toolutil.GetString(args, "filePath")
	if filePath == "" {
		return toolutil.InvalidArgs("create_site", args, "missing filePath")
	}
	if !isSiteFilePath(filePath) {
		return toolutil.InvalidArgs("create_site", args, "filePath must end in .html or .htm")
	}

	html := toolutil.GetString(args, "html")
	if strings.TrimSpace(html) == "" {
		return toolutil.InvalidArgs("create_site", args, "missing html")
	}

	full, ok := filepolicy.PrepareFile(ctx, filePath, &state)
	if !ok {
		return state
	}

	if err := currentSiteWriter().WriteSite(ctx.Ctx, SiteWriteRequest{Path: full, Content: []byte(html)}); err != nil {
		state.Status = "error"
		state.Error = "Error saving site: " + err.Error()
		return state
	}

	state.Output = fmt.Sprintf("Site created successfully at %s", filePath)
	state.Title = filePath
	state.TitleSet = true
	state.Metadata = map[string]any{
		"filepath": filePath,
		"kind":     "site",
	}

	title := toolutil.GetString(args, "title")
	if title != "" {
		state.Metadata["title"] = title
	}

	return state
}

func isSiteFilePath(filePath string) bool {
	normalized := strings.ToLower(filePath)
	return strings.HasSuffix(normalized, ".html") || strings.HasSuffix(normalized, ".htm")
}
