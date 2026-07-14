// Package configsource provides an in-memory enginecore config source for core tests.
package configsource

import enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"

type Source struct {
	Snapshot  enginecoreconfig.ConfigSnapshot
	Writable  enginecoreconfig.ConfigDocument
	StoreFunc func([]byte) error
}

func (s Source) Load() (enginecoreconfig.ConfigSnapshot, error) {
	return s.Snapshot, nil
}

func (s Source) LoadWritable() (enginecoreconfig.ConfigDocument, error) {
	return s.Writable, nil
}

func (s Source) Store(data []byte) error {
	if s.StoreFunc != nil {
		return s.StoreFunc(data)
	}
	return enginecoreconfig.ErrConfigSourceUnavailable
}
