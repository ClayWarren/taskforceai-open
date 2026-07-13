package run

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreEnvConfigSourceLoadsEnvSelectedDocuments(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")
	taskforcePath := filepath.Join(dir, "taskforceai.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{"instructions":["config"]}`), 0o600))
	require.NoError(t, os.WriteFile(taskforcePath, []byte(`{"instructions":["taskforceai"]}`), 0o600))

	t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", dir)
	t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", `{"instructions":["inline"]}`)
	t.Setenv("TASKFORCEAI_CORE_PERMISSION", `{"read":"allow"}`)

	snapshot, err := (enginecoreEnvConfigSource{}).Load()
	require.NoError(t, err)
	require.Len(t, snapshot.Documents, 2)
	assert.Equal(t, configPath, snapshot.Documents[0].Name)
	assert.Equal(t, taskforcePath, snapshot.Documents[1].Name)
	assert.JSONEq(t, `{"instructions":["inline"]}`, string(snapshot.InlineContent))
	assert.JSONEq(t, `{"read":"allow"}`, snapshot.PermissionContent)
	assert.Equal(t, configPath, enginecoreConfigPath())
	assert.Equal(t, []string{configPath, taskforcePath}, enginecoreConfigCandidates())
}

func TestEnginecoreEnvConfigSourceExplicitConfigWins(t *testing.T) {
	explicit := filepath.Join(t.TempDir(), "explicit.json")
	ignoredDir := t.TempDir()

	t.Setenv("TASKFORCEAI_CORE_CONFIG", explicit)
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", ignoredDir)
	t.Setenv("TASKFORCEAI_CORE_ROOT", filepath.Join(t.TempDir(), "ignored-root"))

	assert.Equal(t, explicit, enginecoreConfigPath())
	assert.Equal(t, []string{explicit}, enginecoreConfigCandidates())
}

func TestEnginecoreEnvConfigSourceRuntimeRootFallback(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", "")
	t.Setenv("TASKFORCEAI_CORE_ROOT", root)

	assert.Equal(t, root, enginecoreRuntimeDir())
	assert.Equal(t, filepath.Join(root, "config.json"), enginecoreConfigPath())
	assert.Equal(t, []string{
		filepath.Join(root, "config.json"),
		filepath.Join(root, "taskforceai.json"),
	}, enginecoreConfigCandidates())

	originalGetwd := getEnginecoreWorkingDir
	t.Cleanup(func() { getEnginecoreWorkingDir = originalGetwd })
	t.Setenv("TASKFORCEAI_CORE_ROOT", "")
	getEnginecoreWorkingDir = func() (string, error) {
		return "", assert.AnError
	}
	assert.Equal(t, ".", enginecoreRuntimeDir())
}

func TestEnginecoreEnvConfigSourceStoreWritesSelectedPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("TASKFORCEAI_CORE_CONFIG", path)

	require.NoError(t, (enginecoreEnvConfigSource{}).Store([]byte(`{"model":"m"}`)))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.JSONEq(t, `{"model":"m"}`, string(data))
}

func TestEnginecoreEnvConfigSourceLoadWritableAndMissingDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("TASKFORCEAI_CORE_CONFIG", path)

	doc, err := (enginecoreEnvConfigSource{}).LoadWritable()
	require.NoError(t, err)
	assert.Equal(t, path, doc.Name)
	assert.Empty(t, doc.Data)

	doc, err = readEnginecoreConfigDocument(path)
	require.NoError(t, err)
	assert.Equal(t, path, doc.Name)
	assert.Empty(t, doc.Data)
}

func TestEnginecoreEnvConfigSourceStoreSurfacesWriteError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing", "config.json")
	t.Setenv("TASKFORCEAI_CORE_CONFIG", path)

	err := (enginecoreEnvConfigSource{}).Store([]byte(`{}`))
	require.ErrorContains(t, err, "write config")
}

func TestEnginecoreEnvConfigSourceLoadSurfacesReadErrors(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(dir, "config.json"), 0o700))

	t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", dir)

	_, err := (enginecoreEnvConfigSource{}).Load()
	require.Error(t, err)
	assert.ErrorContains(t, err, "read config")
}
