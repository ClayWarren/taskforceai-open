package run

import (
	"context"
	"os"
	"sync"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
)

type enginecoreFileSiteWriter struct{}

var (
	enginecoreSiteWriterMu        sync.Mutex
	enginecoreSiteWriterInstalled bool
)

func installEnginecoreSiteWriter() {
	enginecoreSiteWriterMu.Lock()
	defer enginecoreSiteWriterMu.Unlock()
	if enginecoreSiteWriterInstalled {
		return
	}
	enginecoretools.SetSiteWriter(enginecoreFileSiteWriter{})
	enginecoreSiteWriterInstalled = true
}

func (enginecoreFileSiteWriter) WriteSite(_ context.Context, request enginecoretools.SiteWriteRequest) error {
	return os.WriteFile(request.Path, request.Content, 0o600)
}
