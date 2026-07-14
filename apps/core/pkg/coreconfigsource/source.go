package coreconfigsource

import (
	"sync"

	sharedsource "github.com/TaskForceAI/adapters/pkg/coreconfigsource"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

var installOnce sync.Once

// Install wires the core config loader to this service's file and environment sources.
func Install() {
	installOnce.Do(func() {
		coreconfig.SetConfigLoaderSource(sharedsource.Source{})
	})
}
