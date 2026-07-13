package core

// ZeroCostCalculator returns zero cost for all usage.
type ZeroCostCalculator struct{}

func (ZeroCostCalculator) FromUsage(_ Usage, _ map[string]any) float64 {
	return 0
}
