package run

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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

func TestCoreConfigFileEnvSourceLocateConfigDocument(t *testing.T) {
	source := coreConfigFileEnvSource{}
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte("models: []"), 0o600))

	doc, err := source.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: configPath})
	require.NoError(t, err)
	assert.Equal(t, configPath, doc.Name)
	assert.Equal(t, configPath, doc.CacheKey)
	assert.NotZero(t, doc.ModTime)

	doc, err = source.LocateConfigDocument(coreconfig.ConfigLoadRequest{EmbeddedDefault: []byte("embedded")})
	require.NoError(t, err)
	assert.Equal(t, "default://embedded", doc.Name)
	assert.Equal(t, []byte("embedded"), doc.Data)
	assert.True(t, doc.HasData)

	_, err = source.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: filepath.Join(dir, "missing.yaml")})
	require.ErrorContains(t, err, "failed to stat config file")
}

func TestCoreConfigFileEnvSourceLocateAbsFailure(t *testing.T) {
	originalAbs := absCoreConfigPath
	t.Cleanup(func() { absCoreConfigPath = originalAbs })
	absCoreConfigPath = func(string) (string, error) {
		return "", errors.New("abs failed")
	}

	_, err := (coreConfigFileEnvSource{}).LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: "config.yaml"})
	require.ErrorContains(t, err, "failed to resolve config path")
}

func TestCoreConfigFileEnvSourceReadConfigDocument(t *testing.T) {
	source := coreConfigFileEnvSource{}
	path := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(path, []byte("ok"), 0o600))

	data, err := source.ReadConfigDocument(coreconfig.ConfigDocument{Name: path})
	require.NoError(t, err)
	assert.Equal(t, []byte("ok"), data)

	_, err = source.ReadConfigDocument(coreconfig.ConfigDocument{Name: filepath.Join(t.TempDir(), "missing.yaml")})
	require.ErrorContains(t, err, "failed to read config file")
}

func TestCoreConfigEnvOverrides(t *testing.T) {
	overrides := coreConfigEnvOverrides{}
	modelID := "openai/gpt-5-mini"
	baseKey := coreConfigModelBaseURLEnvKey(modelID)
	t.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
	t.Setenv(baseKey, "https://model.example")
	t.Setenv("MODEL_BASE_URL_OTHER_MODEL", "https://other.example")

	assert.Equal(t, "gateway-key", overrides.GatewayAPIKey())
	assert.Equal(t, "https://model.example", overrides.ModelBaseURL(modelID))
	assert.NotZero(t, overrides.Fingerprint())
	assert.Equal(t, "MODEL_BASE_URL_OPENAI_GPT_5_MINI", baseKey)
}
