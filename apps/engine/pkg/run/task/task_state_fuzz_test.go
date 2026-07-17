package task

import (
	"encoding/json"
	"testing"
)

// FuzzTaskStateUnmarshal targets the custom State.UnmarshalJSON and its
// hand-rolled parseJSONInt64 (quote-stripping + big.ParseFloat). Task state
// round-trips through Redis and Lua scripts, so partially-written or
// script-mangled JSON must decode cleanly or error — never panic — and a
// successful decode must re-encode.
func FuzzTaskStateUnmarshal(f *testing.F) {
	f.Add([]byte(`{"taskId":"t1","progressVersion":3}`))
	f.Add([]byte(`{"progressVersion":"7"}`))
	f.Add([]byte(`{"progressVersion":"\"9\""}`))
	f.Add([]byte(`{"progressVersion":1e30}`))
	f.Add([]byte(`{"progressVersion":null,"agentStatuses":[{"x":1}],"pendingApproval":{}}`))
	f.Add([]byte(`{"progressVersion":9223372036854775807}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		var task State
		if err := json.Unmarshal(data, &task); err != nil {
			return
		}
		if _, err := json.Marshal(task); err != nil {
			t.Fatalf("decoded State failed to re-encode: %v", err)
		}
	})
}
