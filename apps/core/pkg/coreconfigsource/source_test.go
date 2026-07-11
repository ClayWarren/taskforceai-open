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

func TestInstallIsIdempotent(t *testing.T) {
	assert.NotPanics(t, Install)
	assert.NotPanics(t, Install)
}

func TestFileEnvSource_LocateConfigDocument(t *testing.T) {
	src := fileEnvSource{}

	t.Run("default path missing falls back to embedded", func(t *testing.T) {
		t.Chdir(t.TempDir())
		doc, err := src.LocateConfigDocument(coreconfig.ConfigLoadRequest{
			EmbeddedDefault: []byte("embedded: true"),
		})
		require.NoError(t, err)
		assert.Equal(t, "default://embedded", doc.Name)
		assert.True(t, doc.HasData)
		assert.Equal(t, []byte("embedded: true"), doc.Data)
	})

	t.Run("explicit missing path returns error", func(t *testing.T) {
		_, err := src.LocateConfigDocument(coreconfig.ConfigLoadRequest{
			Path: filepath.Join(t.TempDir(), "missing.yaml"),
		})
		require.Error(t, err)
	})

	t.Run("existing file resolves to absolute document", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "config.yaml")
		require.NoError(t, os.WriteFile(path, []byte("key: value"), 0o600))

		doc, err := src.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: path})
		require.NoError(t, err)
		assert.Equal(t, path, doc.Name)
		assert.Equal(t, path, doc.CacheKey)
		assert.NotZero(t, doc.ModTime)
	})

	t.Run("path resolution failure surfaces error", func(t *testing.T) {
		original := absPath
		absPath = func(string) (string, error) { return "", errors.New("resolve failed") }
		t.Cleanup(func() { absPath = original })

		_, err := src.LocateConfigDocument(coreconfig.ConfigLoadRequest{Path: "config.yaml"})
		require.ErrorContains(t, err, "resolve failed")
	})
}

func TestFileEnvSource_ReadConfigDocument(t *testing.T) {
	src := fileEnvSource{}

	path := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(path, []byte("key: value"), 0o600))

	data, err := src.ReadConfigDocument(coreconfig.ConfigDocument{Name: path})
	require.NoError(t, err)
	assert.Equal(t, []byte("key: value"), data)

	_, err = src.ReadConfigDocument(coreconfig.ConfigDocument{Name: filepath.Join(t.TempDir(), "missing.yaml")})
	require.Error(t, err)
}

func TestFileEnvSource_EnvironmentOverrides(t *testing.T) {
	overrides := fileEnvSource{}.EnvironmentOverrides()

	t.Setenv("AI_GATEWAY_API_KEY", "gw-key")
	t.Setenv("MODEL_BASE_URL_GPT_4O", "https://example.com")

	assert.Equal(t, "gw-key", overrides.GatewayAPIKey())
	assert.Equal(t, "https://example.com", overrides.ModelBaseURL("gpt-4o"))
	assert.NotZero(t, overrides.Fingerprint())

	// Fingerprint changes when a relevant env var changes.
	first := overrides.Fingerprint()
	t.Setenv("MODEL_BASE_URL_GPT_4O", "https://changed.example.com")
	assert.NotEqual(t, first, overrides.Fingerprint())
}

func TestModelBaseURLEnvKey(t *testing.T) {
	assert.Equal(t, "MODEL_BASE_URL_GPT_4O", modelBaseURLEnvKey("gpt-4o"))
	assert.Equal(t, "MODEL_BASE_URL_ANTHROPIC_CLAUDE_3", modelBaseURLEnvKey("anthropic/claude-3"))
}
