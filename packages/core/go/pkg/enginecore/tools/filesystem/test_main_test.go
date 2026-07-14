package filesystem

import (
	"os"
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type allowPermission struct{}

func (allowPermission) Ask(protocol.PermissionRequest) error { return nil }

func TestMain(m *testing.M) {
	restore := util.SetFileSystem(testsupport.OSFileSystem{})
	code := m.Run()
	restore()
	os.Exit(code)
}

func mustReadTestFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path) // #nosec G304 -- tests read controlled temporary files.
	if err != nil {
		t.Fatalf("read test file %q: %v", path, err)
	}
	return data
}
