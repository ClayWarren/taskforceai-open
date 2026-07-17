package coreconfigsource

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSourceLocateConfigDocument(t *testing.T) {
	source := Source{}

	t.Run("default path missing falls back to embedded", func(t *testing.T) {
		t.Chdir(t.TempDir())
		doc, err := source.LocateConfigDocument(coreconfig.ConfigLoadRequest{EmbeddedDefault: []byte("embedded: true")})
		require.NoError(t, err)
		assert.Equal(t, "default://embedded", doc.Name)
		assert.Equal(t, "default://embedded", doc.CacheKey)
		assert.Equal(t, []byte("embedded: true"), doc.Data)
		assert.True(t, doc.HasData)
	})

	t.Run("explicit missing path returns error", func(t *testing.T) {
		_, err := source.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: filepath.Join(t.TempDir(), "missing.yaml")})
		require.ErrorContains(t, err, "failed to stat config file")
	})

	t.Run("existing file resolves to absolute document", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "config.yaml")
		require.NoError(t, os.WriteFile(path, []byte("key: value"), 0o600))
		doc, err := source.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: path})
		require.NoError(t, err)
		assert.Equal(t, path, doc.Name)
		assert.Equal(t, path, doc.CacheKey)
		assert.NotZero(t, doc.ModTime)
	})

	t.Run("path resolution failure surfaces error", func(t *testing.T) {
		source := Source{ResolvePath: func(string) (string, error) { return "", errors.New("resolve failed") }}
		_, err := source.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: "config.yaml"})
		require.ErrorContains(t, err, "resolve failed")
	})
}

func TestSourceReadConfigDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(path, []byte("key: value"), 0o600))

	data, err := (Source{}).ReadConfigDocument(coreconfig.ConfigDocument{Name: path})
	require.NoError(t, err)
	assert.Equal(t, []byte("key: value"), data)

	_, err = (Source{}).ReadConfigDocument(coreconfig.ConfigDocument{Name: filepath.Join(t.TempDir(), "missing.yaml")})
	require.ErrorContains(t, err, "failed to read config file")
}

func TestSourceEnvironmentOverrides(t *testing.T) {
	overrides := (Source{}).EnvironmentOverrides()
	t.Setenv("AI_GATEWAY_API_KEY", "gw-key")
	t.Setenv("MODEL_BASE_URL_OPENAI_GPT_5_MINI", "https://example.com")

	assert.Equal(t, "gw-key", overrides.GatewayAPIKey())
	assert.Equal(t, "https://example.com", overrides.ModelBaseURL("openai/gpt-5-mini"))
	first := overrides.Fingerprint()
	t.Setenv("MODEL_BASE_URL_OPENAI_GPT_5_MINI", "https://changed.example.com")
	assert.NotEqual(t, first, overrides.Fingerprint())
}
