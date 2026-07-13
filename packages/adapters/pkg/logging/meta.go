package logging

import (
	"encoding/json"
	"maps"
)

// BaseLogMeta represents the base metadata attached to every structured log entry.
type BaseLogMeta struct {
	App     string `json:"app"`
	Service string `json:"service"`
	Runtime string `json:"runtime,omitempty"`
}

// unmarshalFunc is the function used to unmarshal JSON. Can be overridden in tests.
var unmarshalFunc = json.Unmarshal

// BuildBaseLogMeta converts BaseLogMeta to a map for use in logging.
func BuildBaseLogMeta(meta BaseLogMeta) map[string]any {
	res := map[string]any{
		"app":     meta.App,
		"service": meta.Service,
	}
	if meta.Runtime != "" {
		res["runtime"] = meta.Runtime
	}
	return res
}

// IsRecord checks if a value is a map (equivalent to TS Record).
func IsRecord(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

// NormalizeMeta merges base metadata and current context metadata with a single log entry's metadata.
func NormalizeMeta(baseMeta map[string]any, contextMeta map[string]any, meta any) map[string]any {
	merged := make(map[string]any)
	maps.Copy(merged, baseMeta)
	maps.Copy(merged, contextMeta)

	if meta == nil {
		if len(merged) == 0 {
			return nil
		}
		return merged
	}

	switch m := meta.(type) {
	case error:
		merged["error"] = map[string]any{
			"message": m.Error(),
		}
	case map[string]any:
		maps.Copy(merged, m)
	default:
		// If it's something else, try to marshal it to see if it's a struct or just put it in "detail"
		data, err := json.Marshal(m)
		if err == nil && len(data) > 0 && data[0] == '{' {
			var m2 map[string]any
			if err := unmarshalFunc(data, &m2); err == nil {
				maps.Copy(merged, m2)
			} else {
				merged["detail"] = m
			}
		} else {
			merged["detail"] = m
		}
	}

	return merged
}
