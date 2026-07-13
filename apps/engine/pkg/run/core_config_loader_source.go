package run

import (
	"sync"

	sharedsource "github.com/TaskForceAI/adapters/pkg/coreconfigsource"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

var (
	coreConfigLoaderSourceMu        sync.Mutex
	coreConfigLoaderSourceInstalled bool
)

func installCoreConfigLoaderSource() {
	coreConfigLoaderSourceMu.Lock()
	defer coreConfigLoaderSourceMu.Unlock()
	if coreConfigLoaderSourceInstalled {
		return
	}
	coreconfig.SetConfigLoaderSource(sharedsource.Source{})
	coreConfigLoaderSourceInstalled = true
}
