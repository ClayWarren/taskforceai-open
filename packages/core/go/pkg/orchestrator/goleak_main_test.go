package orchestrator

import (
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) {
	enginecoreutil.SetFileSystem(testsupport.OSFileSystem{})
	goleak.VerifyTestMain(m)
}
