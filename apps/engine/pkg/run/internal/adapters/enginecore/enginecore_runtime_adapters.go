package enginecoreadapter

import (
	"path/filepath"
	"sync"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
	coretools "github.com/TaskForceAI/core/pkg/tools"
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

// InstallSources installs the engine-owned configuration, runtime, and
// instruction adapters needed while loading core configuration.
func InstallSources() {
	installEnginecoreConfigSource()
	installEnginecoreRuntimeSource()
	installEnginecoreInstructionContextSource()
}

// Install composes every enginecore runtime adapter at the application edge.
func Install() {
	installEnginecoreConfigSource()
	installEnginecoreRuntimeSource()
	installEnginecoreRuntimeAdapters(installEnginecoreInstructionContextSource)
}

// ResetForTest clears process-wide core ports installed by this adapter.
// It is intentionally internal to pkg/run and exists for cross-package tests.
func ResetForTest() {
	enginecoreRuntimeAdaptersMu.Lock()
	enginecoreRuntimeAdaptersInstalled = false
	enginecoreRuntimeAdaptersMu.Unlock()
	enginecoretools.SetWebFetchSource(nil)
	enginecoretools.SetArchiveWriter(nil)
	enginecoretools.SetChartWriter(nil)
	enginecoretools.SetCSVWriter(nil)
	enginecoretools.SetDocumentWriter(nil)
	enginecoretools.SetPDFWriter(nil)
	enginecoretools.SetPresentationWriter(nil)
	enginecoretools.SetSpreadsheetWriter(nil)
	enginecoretools.SetSiteWriter(nil)
	enginecore.SetInstructionContextSource(nil)
	enginecore.SetInstructionFileSource(nil)
	enginecoreconfig.SetConfigSource(nil)
	enginecoreutil.SetRuntimeContextSource(nil)
	coretools.SetEngineCoreToolRuntime(nil)
	globInstructionPattern = filepath.Glob
}
