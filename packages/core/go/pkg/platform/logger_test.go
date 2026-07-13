package platform

import (
	"io"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLogger(t *testing.T) {
	t.Run("GetLogger", func(t *testing.T) {
		l := GetLogger()
		assert.NotNil(t, l)
	})

	t.Run("SetLogger", func(t *testing.T) {
		original := GetLogger()
		t.Cleanup(func() { SetLogger(original) })

		newLogger := slog.New(slog.NewJSONHandler(io.Discard, nil))
		SetLogger(newLogger)

		assert.Equal(t, newLogger, GetLogger())
		assert.NotEqual(t, original, GetLogger())
	})

	t.Run("SetLogger nil falls back to default logger", func(t *testing.T) {
		original := GetLogger()
		t.Cleanup(func() { SetLogger(original) })

		SetLogger(nil)
		assert.NotNil(t, GetLogger())
	})
}
