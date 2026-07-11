package tools

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
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

var (
	siteWriterMu sync.RWMutex
	siteWriter   SiteWriter = emptySiteWriter{}
)

// SetSiteWriter installs the outer writer used by create_site and returns a restore function.
func SetSiteWriter(writer SiteWriter) func() {
	if writer == nil {
		writer = emptySiteWriter{}
	}

	siteWriterMu.Lock()
	previous := siteWriter
	siteWriter = writer
	siteWriterMu.Unlock()

	return func() {
		siteWriterMu.Lock()
		siteWriter = previous
		siteWriterMu.Unlock()
	}
}

func currentSiteWriter() SiteWriter {
	siteWriterMu.RLock()
	writer := siteWriter
	siteWriterMu.RUnlock()
	if writer == nil {
		return emptySiteWriter{}
	}
	return writer
}

func toolCreateSite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	filePath := getString(args, "filePath")
	if filePath == "" {
		return invalidArgs("create_site", args, "missing filePath")
	}
	if !isSiteFilePath(filePath) {
		return invalidArgs("create_site", args, "filePath must end in .html or .htm")
	}

	html := getString(args, "html")
	if strings.TrimSpace(html) == "" {
		return invalidArgs("create_site", args, "missing html")
	}

	full, ok := prepareExternalFile(ctx, filePath, &state)
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

	title := getString(args, "title")
	if title != "" {
		state.Metadata["title"] = title
	}

	return state
}

func isSiteFilePath(filePath string) bool {
	normalized := strings.ToLower(filePath)
	return strings.HasSuffix(normalized, ".html") || strings.HasSuffix(normalized, ".htm")
}
