package coreconfigsource

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

type fileEnvSource struct{}

type envOverrides struct{}

var installOnce sync.Once

// absPath resolves an absolute path. It is a package variable so tests can
// exercise the (otherwise unreachable) resolution-failure branch.
var absPath = filepath.Abs

// Install wires the core config loader to this service's file and environment sources.
func Install() {
	installOnce.Do(func() {
		coreconfig.SetConfigLoaderSource(fileEnvSource{})
	})
}

func (fileEnvSource) LocateConfigDocument(request coreconfig.ConfigLoadRequest) (coreconfig.ConfigDocument, error) {
	configPath := request.Path
	isDefault := false
	if configPath == "" {
		configPath = "config/config.yaml"
		isDefault = true
	}

	resolvedPath, err := absPath(configPath)
	if err != nil {
		return coreconfig.ConfigDocument{}, fmt.Errorf("failed to resolve config path %q: %w", configPath, err)
	}

	info, err := os.Stat(resolvedPath)
	if err != nil {
		if !isDefault {
			cwd, _ := os.Getwd()
			return coreconfig.ConfigDocument{}, fmt.Errorf("failed to stat config file at %q (CWD: %q): %w", resolvedPath, cwd, err)
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
		Name:     resolvedPath,
		CacheKey: resolvedPath,
		ModTime:  info.ModTime().UnixNano(),
	}, nil
}

func (fileEnvSource) ReadConfigDocument(document coreconfig.ConfigDocument) ([]byte, error) {
	data, err := os.ReadFile(document.Name) // #nosec G304 -- path resolved by the config source adapter.
	if err != nil {
		return nil, fmt.Errorf("failed to read config file at %q: %w", document.Name, err)
	}
	return data, nil
}

func (fileEnvSource) EnvironmentOverrides() coreconfig.ConfigEnvironmentOverrides {
	return envOverrides{}
}

func (envOverrides) Fingerprint() uint64 {
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

func (envOverrides) GatewayAPIKey() string {
	return os.Getenv("AI_GATEWAY_API_KEY")
}

func (envOverrides) ModelBaseURL(modelID string) string {
	return os.Getenv(modelBaseURLEnvKey(modelID))
}

func modelBaseURLEnvKey(modelID string) string {
	return "MODEL_BASE_URL_" + strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(modelID, "/", "_"), "-", "_"))
}
