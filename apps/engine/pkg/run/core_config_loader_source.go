package run

import (
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

type coreConfigFileEnvSource struct{}

type coreConfigEnvOverrides struct{}

var (
	coreConfigLoaderSourceMu        sync.Mutex
	coreConfigLoaderSourceInstalled bool
)

var absCoreConfigPath = filepath.Abs

func installCoreConfigLoaderSource() {
	coreConfigLoaderSourceMu.Lock()
	defer coreConfigLoaderSourceMu.Unlock()
	if coreConfigLoaderSourceInstalled {
		return
	}
	coreconfig.SetConfigLoaderSource(coreConfigFileEnvSource{})
	coreConfigLoaderSourceInstalled = true
}

func (coreConfigFileEnvSource) LocateConfigDocument(request coreconfig.ConfigLoadRequest) (coreconfig.ConfigDocument, error) {
	configPath := request.Path
	isDefault := false
	if configPath == "" {
		configPath = "config/config.yaml"
		isDefault = true
	}

	absPath, err := absCoreConfigPath(configPath)
	if err != nil {
		return coreconfig.ConfigDocument{}, fmt.Errorf("failed to resolve config path %q: %w", configPath, err)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		if !isDefault {
			cwd, _ := os.Getwd()
			return coreconfig.ConfigDocument{}, fmt.Errorf("failed to stat config file at %q (CWD: %q): %w", absPath, cwd, err)
		}

		return coreconfig.ConfigDocument{
			Name:     "default://embedded",
			CacheKey: "default://embedded",
			Data:     append([]byte(nil), request.EmbeddedDefault...),
			HasData:  true,
			ModTime:  0,
		}, nil
	}

	return coreconfig.ConfigDocument{
		Name:     absPath,
		CacheKey: absPath,
		ModTime:  info.ModTime().UnixNano(),
	}, nil
}

func (coreConfigFileEnvSource) ReadConfigDocument(document coreconfig.ConfigDocument) ([]byte, error) {
	data, err := os.ReadFile(document.Name) // #nosec G304 -- path resolved by the config source adapter.
	if err != nil {
		return nil, fmt.Errorf("failed to read config file at %q: %w", document.Name, err)
	}
	return data, nil
}

func (coreConfigFileEnvSource) EnvironmentOverrides() coreconfig.ConfigEnvironmentOverrides {
	return coreConfigEnvOverrides{}
}

func (coreConfigEnvOverrides) Fingerprint() uint64 {
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

func (coreConfigEnvOverrides) GatewayAPIKey() string {
	return os.Getenv("AI_GATEWAY_API_KEY")
}

func (coreConfigEnvOverrides) ModelBaseURL(modelID string) string {
	return os.Getenv(coreConfigModelBaseURLEnvKey(modelID))
}

func coreConfigModelBaseURLEnvKey(modelID string) string {
	return "MODEL_BASE_URL_" + strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(modelID, "/", "_"), "-", "_"))
}
