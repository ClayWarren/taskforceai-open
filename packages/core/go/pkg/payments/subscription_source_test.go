package payments

import "testing"

func TestNormalizeSubscriptionSource(t *testing.T) {
	tests := []struct {
		name     string
		source   string
		expected NormalizedSubscriptionSource
		valid    bool
	}{
		{name: "stripe", source: "stripe", expected: NormalizedSourceStripe, valid: true},
		{name: "stripe with whitespace", source: " stripe \n", expected: NormalizedSourceStripe, valid: true},
		{name: "app store", source: "APP_STORE", expected: NormalizedSourceAppStore, valid: true},
		{name: "play store", source: "play_store", expected: NormalizedSourcePlayStore, valid: true},
		{name: "empty", source: "", valid: false},
		{name: "unknown", source: "manual", valid: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := NormalizeSubscriptionSource(tc.source)
			if ok != tc.valid {
				t.Fatalf("valid = %v, want %v", ok, tc.valid)
			}
			if got != tc.expected {
				t.Fatalf("source = %q, want %q", got, tc.expected)
			}
		})
	}
}
