package run

import "testing"

func TestInstallCoreConfigLoaderSourceAlreadyInstalled(t *testing.T) {
	coreConfigLoaderSourceMu.Lock()
	originalInstalled := coreConfigLoaderSourceInstalled
	coreConfigLoaderSourceInstalled = true
	coreConfigLoaderSourceMu.Unlock()
	t.Cleanup(func() {
		coreConfigLoaderSourceMu.Lock()
		coreConfigLoaderSourceInstalled = originalInstalled
		coreConfigLoaderSourceMu.Unlock()
	})

	installCoreConfigLoaderSource()
}
