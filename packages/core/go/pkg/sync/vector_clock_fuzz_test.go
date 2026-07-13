package sync

import "testing"

// FuzzVectorClock exercises the decode -> compare/merge/increment -> encode
// pipeline with arbitrary bytes for both the server and client clock.
func FuzzVectorClock(f *testing.F) {
	f.Add([]byte(`{"a":1,"b":2}`), []byte(`{"a":2}`))
	f.Add([]byte(`null`), []byte(`{}`))
	f.Add([]byte(``), []byte(`{"a":-1}`))
	f.Add([]byte(`{"a":2147483647}`), []byte(`{"a":2147483647}`))
	f.Fuzz(func(t *testing.T, serverData, clientData []byte) {
		serverVC := DecodeVectorClock(serverData)
		clientVC := DecodeVectorClock(clientData)

		got := serverVC.Compare(clientVC)
		inverse := clientVC.Compare(serverVC)
		want := map[ComparisonResult]ComparisonResult{
			Equal: Equal, Before: After, After: Before, Concurrent: Concurrent,
		}[got]
		if inverse != want {
			t.Fatalf("Compare not symmetric: a.Compare(b)=%d but b.Compare(a)=%d", got, inverse)
		}

		clientVC.Merge(serverVC)
		clientVC.Increment("fuzz-device")
		if clientVC.Compare(serverVC) == Before {
			t.Fatal("merged+incremented clock compares Before its merge source")
		}

		decoded := DecodeVectorClock(clientVC.Encode())
		if decoded.Compare(clientVC) != Equal {
			t.Fatal("encode/decode round-trip changed the clock")
		}
	})
}
