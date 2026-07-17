package transports

import (
	"errors"
	"fmt"
	"time"

	"github.com/TaskForceAI/logger/pkg"
	"github.com/getsentry/sentry-go"
)

var sanitizeSentryValue = pkg.SanitizeValue

type SentryTransport struct {
	levels map[pkg.LogLevel]bool
}

func NewSentryTransport(levels []pkg.LogLevel) *SentryTransport {
	lvlMap := make(map[pkg.LogLevel]bool)
	if len(levels) == 0 {
		lvlMap[pkg.LevelError] = true
	} else {
		for _, l := range levels {
			lvlMap[l] = true
		}
	}
	return &SentryTransport{levels: lvlMap}
}

func (t *SentryTransport) Name() string {
	return "sentry"
}

func (t *SentryTransport) Log(entry pkg.LogEntry) error {
	if !t.levels[entry.Level] {
		return nil
	}

	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(t.mapLevel(entry.Level))
		scope.SetContext("log", map[string]any{"message": entry.Message})
		if len(entry.Context) > 0 {
			if sanitizedContext, ok := sanitizeSentryValue(entry.Context).(map[string]any); ok {
				scope.SetContext("logger", sanitizedContext)
			} else {
				scope.SetContext("logger", entry.Context)
			}
		}
		if len(entry.Metadata) > 0 {
			if sanitizedMeta, ok := sanitizeSentryValue(entry.Metadata).(map[string]any); ok {
				scope.SetContext("metadata", sanitizedMeta)
			} else {
				scope.SetContext("metadata", entry.Metadata)
			}
		}

		if entry.Err != nil {
			sentry.CaptureException(sentrySafeError(entry.Err))
		} else {
			sentry.CaptureMessage(entry.Message)
		}
	})

	return nil
}

func (t *SentryTransport) Flush() error {
	sentry.Flush(2 * time.Second)
	return nil
}

func (t *SentryTransport) mapLevel(l pkg.LogLevel) sentry.Level {
	switch l {
	case pkg.LevelDebug:
		return sentry.LevelDebug
	case pkg.LevelInfo:
		return sentry.LevelInfo
	case pkg.LevelWarn:
		return sentry.LevelWarning
	case pkg.LevelError:
		return sentry.LevelError
	default:
		return sentry.LevelInfo
	}
}

func sentrySafeError(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(safeErrorMessage(err))
}

func safeErrorMessage(err error) (message string) {
	defer func() {
		if recoverValue := recover(); recoverValue != nil {
			message = fmt.Sprintf("error string unavailable: %v", recoverValue)
		}
	}()
	return err.Error()
}
