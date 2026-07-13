package run

import (
	"sync"

	coretools "github.com/TaskForceAI/core/pkg/tools"
	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
)

var (
	enginecoreRuntimeAdaptersMu        sync.Mutex
	enginecoreRuntimeAdaptersInstalled bool
)

// installEnginecoreRuntimeAdapters preserves the original composition order:
// tool runtime, lifecycle sources, then concrete tool sources and writers.
func installEnginecoreRuntimeAdapters(installLifecycleSources func()) {
	enginecoreRuntimeAdaptersMu.Lock()
	defer enginecoreRuntimeAdaptersMu.Unlock()

	if enginecoreRuntimeAdaptersInstalled {
		installLifecycleSources()
		return
	}

	coretools.SetEngineCoreToolRuntime(enginecoreFileToolRuntime{})
	installLifecycleSources()
	enginecoretools.SetWebFetchSource(enginecoreHTTPWebFetchSource{})
	enginecoretools.SetArchiveWriter(enginecoreFileArchiveWriter{})
	enginecoretools.SetChartWriter(enginecoreFileChartWriter{})
	enginecoretools.SetCSVWriter(enginecoreFileCSVWriter{})
	enginecoretools.SetDocumentWriter(enginecoreFileDocumentWriter{})
	enginecoretools.SetPDFWriter(enginecoreFilePDFWriter{})
	enginecoretools.SetPresentationWriter(enginecoreFilePresentationWriter{})
	enginecoretools.SetSpreadsheetWriter(enginecoreFileSpreadsheetWriter{})
	enginecoretools.SetSiteWriter(enginecoreFileSiteWriter{})
	enginecoreRuntimeAdaptersInstalled = true
}
