package handler

import (
	"fmt"
)

// WithBackgroundRecovery wraps a function with panic recovery tailored for background goroutines.
// It reports the panic to Sentry and logs it.
func WithBackgroundRecovery(name string, fn func()) {
	defer func() {
		if err := recover(); err != nil {
			getPanicReporter().ReportBackgroundPanic(name, err)

			GetLogger().Error("Background panic recovered", map[string]any{
				"name":  name,
				"error": fmt.Sprintf("%v", err),
			})
		}
	}()
	fn()
}

// Go safe wrapper for spawning background goroutines with recovery
func Go(name string, fn func()) {
	go WithBackgroundRecovery(name, fn)
}
