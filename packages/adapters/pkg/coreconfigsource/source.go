package coreconfigsource

import (
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

// Source adapts filesystem and environment configuration to the core config port.
type Source struct {
	ResolvePath func(string) (string, error)
}

type environmentOverrides struct{}

func (source Source) LocateConfigDocument(request coreconfig.ConfigLoadRequest) (coreconfig.ConfigDocument, error) {
	configPath := request.Path
	isDefault := false
	if configPath == "" {
		configPath = "config/config.yaml"
		isDefault = true
	}

	resolvePath := source.ResolvePath
	if resolvePath == nil {
		resolvePath = filepath.Abs
	}
	resolvedPath, err := resolvePath(configPath)
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
		}, nil
	}

	return coreconfig.ConfigDocument{
		Name: resolvedPath, CacheKey: resolvedPath, ModTime: info.ModTime().UnixNano(),
	}, nil
}

func (Source) ReadConfigDocument(document coreconfig.ConfigDocument) ([]byte, error) {
	data, err := os.ReadFile(document.Name) // #nosec G304 -- path resolved by the config source adapter.
	if err != nil {
		return nil, fmt.Errorf("failed to read config file at %q: %w", document.Name, err)
	}
	return data, nil
}

func (Source) EnvironmentOverrides() coreconfig.ConfigEnvironmentOverrides {
	return environmentOverrides{}
}

func (environmentOverrides) Fingerprint() uint64 {
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

func (environmentOverrides) GatewayAPIKey() string {
	return os.Getenv("AI_GATEWAY_API_KEY")
}

func (environmentOverrides) ModelBaseURL(modelID string) string {
	key := "MODEL_BASE_URL_" + strings.ToUpper(strings.NewReplacer("/", "_", "-", "_").Replace(modelID))
	return os.Getenv(key)
}
