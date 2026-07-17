package convert

import (
	"fmt"
	"math"
)

func Int32(value int, field string) (int32, error) {
	if value < math.MinInt32 || value > math.MaxInt32 {
		return 0, fmt.Errorf("%s exceeds int32 range", field)
	}
	return int32(value), nil
}

func ClampInt32(value int) int32 {
	// #nosec G115 -- the value is explicitly clamped to the int32 range.
	return int32(max(math.MinInt32, min(value, math.MaxInt32)))
}

func CapInt32(value int) int {
	return min(value, math.MaxInt32)
}

func Int32Slice(values []int, field string) ([]int32, error) {
	out := make([]int32, len(values))
	for i, value := range values {
		var err error
		if out[i], err = Int32(value, field); err != nil {
			return nil, err
		}
	}
	return out, nil
}
