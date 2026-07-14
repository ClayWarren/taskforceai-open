package engine

import (
	"os"
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
)

func TestMain(m *testing.M) {
	restore := enginecoreutil.SetFileSystem(testsupport.OSFileSystem{})
	code := m.Run()
	restore()
	os.Exit(code)
}
