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

func mustReadTestFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path) // #nosec G304 -- tests read files they create under t.TempDir or controlled temp paths.
	if err != nil {
		t.Fatalf("read test file %q: %v", path, err)
	}
	return data
}
