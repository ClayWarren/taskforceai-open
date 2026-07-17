package enginecoreadapter

import (
	"fmt"
	"os"
	"path/filepath"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
)

type enginecoreEnvConfigSource struct{}

var getEnginecoreWorkingDir = os.Getwd

func installEnginecoreConfigSource() {
	enginecoreconfig.SetConfigSource(enginecoreEnvConfigSource{})
}

func (enginecoreEnvConfigSource) Load() (enginecoreconfig.ConfigSnapshot, error) {
	docs, err := loadEnginecoreConfigDocuments(enginecoreConfigCandidates())
	if err != nil {
		return enginecoreconfig.ConfigSnapshot{}, err
	}
	return enginecoreconfig.ConfigSnapshot{
		Documents:         docs,
		InlineContent:     []byte(os.Getenv("TASKFORCEAI_CORE_CONFIG_CONTENT")),
		PermissionContent: os.Getenv("TASKFORCEAI_CORE_PERMISSION"),
	}, nil
}

func (enginecoreEnvConfigSource) LoadWritable() (enginecoreconfig.ConfigDocument, error) {
	return readEnginecoreConfigDocument(enginecoreConfigPath())
}

func (enginecoreEnvConfigSource) Store(data []byte) error {
	if err := os.WriteFile(enginecoreConfigPath(), data, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

func loadEnginecoreConfigDocuments(candidates []string) ([]enginecoreconfig.ConfigDocument, error) {
	docs := make([]enginecoreconfig.ConfigDocument, 0, len(candidates))
	loaded := false
	var lastErr error
	for _, file := range candidates {
		if _, err := os.Stat(file); err == nil {
			doc, err := readEnginecoreConfigDocument(file)
			if err != nil {
				lastErr = err
				continue
			}
			loaded = true
			docs = append(docs, doc)
		}
	}
	if !loaded && lastErr != nil {
		return nil, lastErr
	}
	return docs, nil
}

func readEnginecoreConfigDocument(path string) (enginecoreconfig.ConfigDocument, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- path is selected by the engine config adapter.
	if err != nil {
		if os.IsNotExist(err) {
			return enginecoreconfig.ConfigDocument{Name: path}, nil
		}
		return enginecoreconfig.ConfigDocument{}, fmt.Errorf("read config: %w", err)
	}
	return enginecoreconfig.ConfigDocument{Name: path, Data: data}, nil
}

func enginecoreConfigPath() string {
	if v := os.Getenv("TASKFORCEAI_CORE_CONFIG"); v != "" {
		return v
	}
	if v := os.Getenv("TASKFORCEAI_CORE_CONFIG_DIR"); v != "" {
		return filepath.Join(v, "config.json")
	}
	return filepath.Join(enginecoreRuntimeDir(), "config.json")
}

func enginecoreConfigCandidates() []string {
	if v := os.Getenv("TASKFORCEAI_CORE_CONFIG"); v != "" {
		return []string{v}
	}
	base := os.Getenv("TASKFORCEAI_CORE_CONFIG_DIR")
	if base == "" {
		base = enginecoreRuntimeDir()
	}
	return []string{
		filepath.Join(base, "config.json"),
		filepath.Join(base, "taskforceai.json"),
	}
}

func enginecoreRuntimeDir() string {
	if v := os.Getenv("TASKFORCEAI_CORE_ROOT"); v != "" {
		return v
	}
	if cwd, err := getEnginecoreWorkingDir(); err == nil {
		return cwd
	}
	return "."
}
