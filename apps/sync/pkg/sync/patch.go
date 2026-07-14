package sync

import (
	"encoding/json"

	jsonpatch "github.com/evanphx/json-patch/v5"
)

func (s *Service) applyPatch(obj any, patchBytes []byte) ([]byte, error) {
	doc, err := json.Marshal(obj)
	if err != nil {
		return nil, err
	}

	patch, err := jsonpatch.DecodePatch(patchBytes)
	if err != nil {
		return nil, err
	}

	return patch.Apply(doc)
}
