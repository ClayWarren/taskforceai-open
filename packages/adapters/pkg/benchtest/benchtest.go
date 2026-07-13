// Package benchtest provides shared helpers for latency benchmark tests.
package benchtest

import (
	"sort"
	"testing"
	"time"
)

// ReportLatencyProfile reports p50/p95/p99 latency metrics for the collected samples.
func ReportLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(PercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(PercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(PercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

// PercentileDuration returns the value at the given percentile of an ascending-sorted slice.
func PercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}
