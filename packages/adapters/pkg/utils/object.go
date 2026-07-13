package utils

import "encoding/json"

// DeepClone creates a deep copy of an object using JSON marshaling/unmarshaling.
func DeepClone[T any](obj T) T {
	data, err := json.Marshal(obj)
	if err != nil {
		var zero T
		return zero
	}
	var clone T
	if err := json.Unmarshal(data, &clone); err != nil {
		var zero T
		return zero
	}
	return clone
}
