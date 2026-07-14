package configadapter

import (
	"sync"

	sharedsource "github.com/TaskForceAI/adapters/pkg/coreconfigsource"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

var (
	coreConfigLoaderSourceMu        sync.Mutex
	coreConfigLoaderSourceInstalled bool
)

// InstallConfigLoaderSource installs the engine's shared config source once.
func InstallConfigLoaderSource() {
	coreConfigLoaderSourceMu.Lock()
	defer coreConfigLoaderSourceMu.Unlock()
	if coreConfigLoaderSourceInstalled {
		return
	}
	coreconfig.SetConfigLoaderSource(sharedsource.Source{})
	coreConfigLoaderSourceInstalled = true
}

// ResetForTest clears process-wide installation state owned by this adapter.
func ResetForTest() {
	coreConfigLoaderSourceMu.Lock()
	coreConfigLoaderSourceInstalled = false
	coreConfigLoaderSourceMu.Unlock()
	coreconfig.SetConfigLoaderSource(nil)
}
