package orchestrator

import (
	"fmt"

	"github.com/TaskForceAI/core/pkg/platform"
)

type BackgroundPanicReporter interface {
	ReportBackgroundPanic(name string, recovered any)
}

func withBackgroundRecovery(name string, reporter BackgroundPanicReporter, fn func()) {
	defer func() {
		if err := recover(); err != nil {
			if reporter != nil {
				reporter.ReportBackgroundPanic(name, err)
			}

			platform.GetLogger().Error("Background panic recovered", "name", name, "error", fmt.Sprintf("%v", err))
		}
	}()

	fn()
}
