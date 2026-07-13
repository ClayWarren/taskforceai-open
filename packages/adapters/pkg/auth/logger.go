package auth

import (
	"sync"

	"github.com/TaskForceAI/adapters/pkg/logging"
)

var (
	authLogger     logging.Logger
	authLoggerOnce sync.Once
)

// GetAuthLogger returns a shared logger instance for the auth package.
func GetAuthLogger() logging.Logger {
	authLoggerOnce.Do(func() {
		// Default to info level for now.
		authLogger = logging.NewStructuredLogger(logging.LevelInfo, "production", map[string]any{
			"component": "adapters-auth",
		})
	})
	return authLogger
}
