package tools

import (
	"os"
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

func TestMain(m *testing.M) {
	restore := util.SetFileSystem(testsupport.OSFileSystem{})
	code := m.Run()
	restore()
	os.Exit(code)
}
