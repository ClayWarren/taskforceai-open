package benchmarktest

import (
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"
)

func Profile(b *testing.B, operation func() error) {
	b.Helper()
	samples := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		startedAt := time.Now()
		err := operation()
		samples = append(samples, time.Since(startedAt))
		if err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	report(b, samples)
}

func ProfileHTTP(b *testing.B, handler http.Handler, request func() *http.Request) {
	b.Helper()
	samples := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		response := httptest.NewRecorder()
		req := request()
		startedAt := time.Now()
		handler.ServeHTTP(response, req)
		samples = append(samples, time.Since(startedAt))
		if response.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", response.Code)
		}
	}
	b.StopTimer()
	report(b, samples)
}

func report(b *testing.B, samples []time.Duration) {
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	for percentile, name := range map[float64]string{0.50: "p50_us", 0.95: "p95_us", 0.99: "p99_us"} {
		index := max(1, min(len(samples), int(float64(len(samples))*percentile+0.999999)))
		b.ReportMetric(float64(samples[index-1].Nanoseconds())/1000, name)
	}
}
