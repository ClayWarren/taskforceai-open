package config

import (
	"errors"
	"testing"
)

type edgeConfigSource struct {
	snapshot ConfigSnapshot
	loadErr  error
	writable ConfigDocument
	storeErr error
}

func testStringPtr(value string) *string {
	return &value
}

func (s edgeConfigSource) Load() (ConfigSnapshot, error) {
	return s.snapshot, s.loadErr
}

func (s edgeConfigSource) LoadWritable() (ConfigDocument, error) {
	return s.writable, nil
}

func (s edgeConfigSource) Store([]byte) error {
	return s.storeErr
}

func isolateConfigSource(t *testing.T, source ConfigSource) {
	t.Helper()
	sourceMu.Lock()
	previous := configSource
	configSource = source
	sourceMu.Unlock()
	Reset()
	t.Cleanup(func() {
		sourceMu.Lock()
		configSource = previous
		sourceMu.Unlock()
		Reset()
	})
}

func TestConfigSourceFallbackBranches(t *testing.T) {
	isolateConfigSource(t, emptyConfigSource{})
	empty := emptyConfigSource{}
	if _, err := empty.Load(); err != nil {
		t.Fatalf("empty source load should succeed, got %v", err)
	}
	if _, err := empty.LoadWritable(); err != nil {
		t.Fatalf("empty source writable load should succeed, got %v", err)
	}
	if err := empty.Store(nil); !errors.Is(err, ErrConfigSourceUnavailable) {
		t.Fatalf("expected unavailable store error, got %v", err)
	}

	restore := SetConfigSource(nil)
	if err := currentConfigSource().Store(nil); !errors.Is(err, ErrConfigSourceUnavailable) {
		t.Fatalf("nil source should install empty source, got %v", err)
	}
	restore()

	sourceMu.Lock()
	configSource = nil
	sourceMu.Unlock()
	if err := currentConfigSource().Store(nil); !errors.Is(err, ErrConfigSourceUnavailable) {
		t.Fatalf("nil stored source should resolve to empty source, got %v", err)
	}
}

func TestLoadFromSourceAndUpdateErrorBranches(t *testing.T) {
	isolateConfigSource(t, emptyConfigSource{})
	if cfg, err := loadFromSource(nil); err != nil || cfg == nil {
		t.Fatalf("nil source should load empty config, cfg=%#v err=%v", cfg, err)
	}

	_, err := loadFromSource(edgeConfigSource{snapshot: ConfigSnapshot{
		Documents: []ConfigDocument{{Name: "bad.json", Data: []byte(`{`)}},
	}})
	if err == nil {
		t.Fatal("expected document decode error")
	}

	err = Update(&Info{Model: testStringPtr("model")})
	if err == nil || !errors.Is(err, ErrConfigSourceUnavailable) {
		t.Fatalf("expected unavailable update store/load error, got %v", err)
	}

	restore := SetConfigSource(edgeConfigSource{
		writable: ConfigDocument{Name: "bad.json", Data: []byte(`{`)},
	})
	t.Cleanup(restore)
	if err := Update(&Info{Model: testStringPtr("model")}); err == nil {
		t.Fatal("expected writable document decode error")
	}
}
