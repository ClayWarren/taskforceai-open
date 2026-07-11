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
	if value < math.MinInt32 {
		return math.MinInt32
	}
	if value > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(value)
}

func CapInt32(value int) int {
	if value > math.MaxInt32 {
		return math.MaxInt32
	}
	return value
}

func Int32Slice(values []int, field string) ([]int32, error) {
	out := make([]int32, len(values))
	for i, value := range values {
		converted, err := Int32(value, field)
		if err != nil {
			return nil, err
		}
		out[i] = converted
	}
	return out, nil
}
