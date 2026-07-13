package config

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

var getConfigWorkingDir = os.Getwd

type testEnvConfigSource struct{}

func TestMain(m *testing.M) {
	SetConfigSource(testEnvConfigSource{})
	os.Exit(m.Run())
}

func (testEnvConfigSource) Load() (ConfigSnapshot, error) {
	docs, err := loadTestConfigDocuments(configCandidates())
	if err != nil {
		return ConfigSnapshot{}, err
	}
	return ConfigSnapshot{
		Documents:         docs,
		InlineContent:     []byte(os.Getenv("TASKFORCEAI_CORE_CONFIG_CONTENT")),
		PermissionContent: os.Getenv("TASKFORCEAI_CORE_PERMISSION"),
	}, nil
}

func (testEnvConfigSource) LoadWritable() (ConfigDocument, error) {
	return readTestConfigDocument(configPath())
}

func (testEnvConfigSource) Store(data []byte) error {
	if err := os.WriteFile(configPath(), data, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

func configPath() string {
	if v := os.Getenv("TASKFORCEAI_CORE_CONFIG"); v != "" {
		return v
	}
	if v := os.Getenv("TASKFORCEAI_CORE_CONFIG_DIR"); v != "" {
		return filepath.Join(v, "config.json")
	}
	return filepath.Join(runtimeDir(), "config.json")
}

func configCandidates() []string {
	if v := os.Getenv("TASKFORCEAI_CORE_CONFIG"); v != "" {
		return []string{v}
	}
	base := os.Getenv("TASKFORCEAI_CORE_CONFIG_DIR")
	if base == "" {
		base = runtimeDir()
	}
	return []string{
		filepath.Join(base, "config.json"),
		filepath.Join(base, "taskforceai.json"),
	}
}

func runtimeDir() string {
	if v := os.Getenv("TASKFORCEAI_CORE_ROOT"); v != "" {
		return v
	}
	if cwd, err := getConfigWorkingDir(); err == nil {
		return cwd
	}
	return "."
}

func loadFile(path string) (*Info, error) {
	doc, err := readTestConfigDocument(path)
	if err != nil {
		return nil, err
	}
	return decodeConfigDocument(doc)
}

func loadTestConfigDocuments(candidates []string) ([]ConfigDocument, error) {
	docs := make([]ConfigDocument, 0, len(candidates))
	loaded := false
	var lastErr error
	for _, file := range candidates {
		if _, err := os.Stat(file); err == nil {
			doc, err := readTestConfigDocument(file)
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

func readTestConfigDocument(path string) (ConfigDocument, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ConfigDocument{Name: path}, nil
		}
		return ConfigDocument{}, fmt.Errorf("read config: %w", err)
	}
	return ConfigDocument{Name: path, Data: data}, nil
}
