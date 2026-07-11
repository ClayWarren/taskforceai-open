package sync

import (
	"encoding/json"
	"sort"
	"strconv"
)

// VectorClock represents a map of device IDs to their local logical versions.
type VectorClock map[string]int32

// ComparisonResult represents the causality relationship between two clocks.
// All comparisons are from the perspective of the receiver (vc) vs. the argument (other).
type ComparisonResult int

const (
	// Equal means vc and other are identical: same causal history.
	Equal ComparisonResult = 0
	// Before means vc happened-before other: vc is causally older.
	Before ComparisonResult = -1
	// After means vc happened-after other: other is causally older.
	After ComparisonResult = 1
	// Concurrent means neither vc <= other nor other <= vc: the histories diverged.
	Concurrent ComparisonResult = 2
)

// DecodeVectorClock decodes a JSON byte slice into a VectorClock.
func DecodeVectorClock(data []byte) VectorClock {
	var vc VectorClock
	if len(data) == 0 {
		return make(VectorClock)
	}
	if err := json.Unmarshal(data, &vc); err != nil {
		return make(VectorClock)
	}
	// JSON "null" unmarshals successfully but leaves the map nil; callers
	// write to the result (Merge/Increment), which panics on a nil map.
	if vc == nil {
		return make(VectorClock)
	}
	return vc
}

// Encode encodes the VectorClock to a JSON byte slice.
func (vc VectorClock) Encode() []byte {
	if vc == nil {
		return []byte("{}")
	}

	keys := vc.Keys()
	data := make([]byte, 0, 2+len(keys)*16)
	data = append(data, '{')
	for index, key := range keys {
		if index > 0 {
			data = append(data, ',')
		}
		data = strconv.AppendQuote(data, key)
		data = append(data, ':')
		data = strconv.AppendInt(data, int64(vc[key]), 10)
	}
	return append(data, '}')
}

// Compare compares this clock (vc) with another clock (other).
//
// Returns:
//   - Before if vc < other
//   - After if vc > other
//   - Equal if vc == other
//   - Concurrent if neither dominates
func (vc VectorClock) Compare(other VectorClock) ComparisonResult {
	vcLtOther := false
	otherLtVc := false

	for k, v1 := range vc {
		v2 := other[k]

		if v1 < v2 {
			vcLtOther = true
		} else if v1 > v2 {
			otherLtVc = true
		}
		if vcLtOther && otherLtVc {
			return Concurrent
		}
	}

	for k, v2 := range other {
		if _, checked := vc[k]; checked {
			continue
		}
		if 0 < v2 {
			vcLtOther = true
		} else if 0 > v2 {
			otherLtVc = true
		}
		if vcLtOther && otherLtVc {
			return Concurrent
		}
	}

	if vcLtOther {
		return Before
	}
	if otherLtVc {
		return After
	}
	return Equal
}

// Increment increments the version for a specific device.
func (vc VectorClock) Increment(deviceID string) {
	vc[deviceID]++
}

// Merge merges another clock into this one by taking the maximum version for each device.
func (vc VectorClock) Merge(other VectorClock) {
	for k, v2 := range other {
		v1, exists := vc[k]
		if !exists || v2 > v1 {
			vc[k] = v2
		}
	}
}

// Keys returns a sorted list of device IDs in the clock.
func (vc VectorClock) Keys() []string {
	keys := make([]string, 0, len(vc))
	for k := range vc {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
