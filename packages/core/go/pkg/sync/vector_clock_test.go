package sync

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestVectorClock_EncodeDecode(t *testing.T) {
	vc := VectorClock{"a": 1, "b": 2}
	encoded := vc.Encode()
	decoded := DecodeVectorClock(encoded)
	assert.Equal(t, vc, decoded)

	assert.Equal(t, VectorClock{}, DecodeVectorClock(nil))
	assert.Equal(t, VectorClock{}, DecodeVectorClock([]byte("{invalid")))

	// JSON "null" must yield a writable map, not nil; Merge/Increment write
	// to the decoded clock and would panic on a nil map.
	fromNull := DecodeVectorClock([]byte("null"))
	assert.Equal(t, VectorClock{}, fromNull)
	assert.NotPanics(t, func() { fromNull.Increment("device-1") })
	assert.Equal(t, int32(1), fromNull["device-1"])
}

func TestVectorClock_Compare(t *testing.T) {
	base := VectorClock{"a": 1}
	assert.Equal(t, Equal, base.Compare(VectorClock{"a": 1}))
	assert.Equal(t, Before, base.Compare(VectorClock{"a": 2}))
	assert.Equal(t, After, base.Compare(VectorClock{"a": 0}))
	assert.Equal(t, Before, base.Compare(VectorClock{"a": 2, "b": 1}))
	assert.Equal(t, Equal, VectorClock(nil).Compare(VectorClock{}))
}

func TestVectorClock_EncodeAndCompareNil(t *testing.T) {
	var nilClock VectorClock
	if string(nilClock.Encode()) != "{}" {
		t.Fatalf("expected nil clock to encode as empty object")
	}
	if nilClock.Compare(nil) != Equal {
		t.Fatalf("expected nil clocks to compare equal")
	}
}

func TestVectorClock_IncrementMergeKeys(t *testing.T) {
	vc := VectorClock{}
	vc.Increment("device1")
	vc.Increment("device1")
	assert.Equal(t, int32(2), vc["device1"])

	other := VectorClock{"device1": 1, "device2": 3}
	vc.Merge(other)
	assert.Equal(t, int32(2), vc["device1"])
	assert.Equal(t, int32(3), vc["device2"])

	keys := vc.Keys()
	assert.Equal(t, []string{"device1", "device2"}, keys)

	var m map[string]int32
	assert.NoError(t, json.Unmarshal(vc.Encode(), &m))
}

func BenchmarkVectorClockCompare_MostlyEqualLargeClocks(b *testing.B) {
	server := makeBenchmarkVectorClock()
	client := makeBenchmarkVectorClock()
	client["device-255"] = 257

	b.ReportAllocs()
	for b.Loop() {
		if got := server.Compare(client); got != Before {
			b.Fatalf("Compare = %d, want Before", got)
		}
	}
}

func BenchmarkVectorClockCompare_ConcurrentLargeClocks(b *testing.B) {
	server := makeBenchmarkVectorClock()
	client := makeBenchmarkVectorClock()
	server["device-030"] = 400
	client["device-220"] = 500

	b.ReportAllocs()
	for b.Loop() {
		if got := server.Compare(client); got != Concurrent {
			b.Fatalf("Compare = %d, want Concurrent", got)
		}
	}
}

func makeBenchmarkVectorClock() VectorClock {
	const size = 256
	vc := make(VectorClock, size)
	for i := range size {
		vc[fmt.Sprintf("device-%03d", i)] = int32(i)
	}
	return vc
}
