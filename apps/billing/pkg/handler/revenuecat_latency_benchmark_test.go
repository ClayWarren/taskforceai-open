package handler_test

import (
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
	auth_handler "github.com/TaskForceAI/billing-service/pkg/handler"
)

func BenchmarkRevenueCatSignatureValidationLatencyProfile(b *testing.B) {
	payload := []byte(`{"app_user_id":"user-1","event":{"app_user_id":"user-1","type":"INITIAL_PURCHASE"}}`)
	secret := "webhook-secret"
	signature := revenueCatSignature(payload, secret)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		startedAt := time.Now()
		valid := auth_handler.VerifyRevenueCatSignature(payload, signature, secret)
		samples = append(samples, time.Since(startedAt))
		if !valid {
			b.Fatalf("expected valid RevenueCat signature")
		}
	}
	b.StopTimer()
	reportRevenueCatLatencyProfile(b, samples)
}

func reportRevenueCatLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(revenueCatDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(revenueCatDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(revenueCatDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.99)), "p99_us")
}

func revenueCatDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
