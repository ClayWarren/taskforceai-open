package config

import (
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

var (
	filepathAbs = filepath.Abs
	osStat      = os.Stat
	osReadFile  = os.ReadFile
	osGetwd     = os.Getwd
)

func TestMain(m *testing.M) {
	SetConfigLoaderSource(testConfigLoaderSource{})
	os.Exit(m.Run())
}

type testConfigLoaderSource struct{}

func (testConfigLoaderSource) LocateConfigDocument(request ConfigLoadRequest) (ConfigDocument, error) {
	configPath := request.Path
	isDefault := false
	if configPath == "" {
		configPath = "config/config.yaml"
		isDefault = true
	}

	absPath, err := filepathAbs(configPath)
	if err != nil {
		return ConfigDocument{}, fmt.Errorf("failed to resolve config path %q: %w", configPath, err)
	}

	info, err := osStat(absPath)
	if err != nil {
		if !isDefault {
			cwd, _ := osGetwd()
			return ConfigDocument{}, fmt.Errorf("failed to stat config file at %q (CWD: %q): %w", absPath, cwd, err)
		}

		return ConfigDocument{
			Name:     "default://embedded",
			CacheKey: "default://embedded",
			Data:     append([]byte(nil), request.EmbeddedDefault...),
			HasData:  true,
			ModTime:  0,
		}, nil
	}

	return ConfigDocument{
		Name:     absPath,
		CacheKey: absPath,
		ModTime:  info.ModTime().UnixNano(),
	}, nil
}

func (testConfigLoaderSource) ReadConfigDocument(document ConfigDocument) ([]byte, error) {
	data, err := osReadFile(document.Name)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file at %q: %w", document.Name, err)
	}
	return data, nil
}

func (testConfigLoaderSource) EnvironmentOverrides() ConfigEnvironmentOverrides {
	return testConfigEnvironmentOverrides{}
}

type testConfigEnvironmentOverrides struct{}

func (testConfigEnvironmentOverrides) Fingerprint() uint64 {
	return envOverridesFingerprint()
}

func (testConfigEnvironmentOverrides) GatewayAPIKey() string {
	return os.Getenv("AI_GATEWAY_API_KEY")
}

func (testConfigEnvironmentOverrides) ModelBaseURL(modelID string) string {
	return os.Getenv(modelBaseURLEnvKey(modelID))
}

func envOverridesFingerprint() uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(os.Getenv("AI_GATEWAY_API_KEY")))
	_, _ = h.Write([]byte{0})

	env := os.Environ()
	sort.Strings(env)
	for _, kv := range env {
		if strings.HasPrefix(kv, "MODEL_BASE_URL_") {
			_, _ = h.Write([]byte(kv))
			_, _ = h.Write([]byte{0})
		}
	}

	return h.Sum64()
}

func modelBaseURLEnvKey(modelID string) string {
	return "MODEL_BASE_URL_" + strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(modelID, "/", "_"), "-", "_"))
}
