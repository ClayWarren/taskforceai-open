package pulse

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNormalizeActiveHoursTime(t *testing.T) {
	got, err := NormalizeActiveHoursTime(" 24:00 ")
	if err != nil || got != "24:00" {
		t.Fatalf("NormalizeActiveHoursTime() = %q, %v", got, err)
	}
	if _, err := NormalizeActiveHoursTime("24:01"); err == nil {
		t.Fatal("expected invalid active-hours time")
	}
}

func TestIsWithinActiveHours(t *testing.T) {
	// Standard window: 09:00 - 17:00
	ah := &ActiveHours{Start: "09:00", End: "17:00", Timezone: "UTC"}

	tests := []struct {
		now      time.Time
		expected bool
	}{
		{time.Date(2026, 2, 12, 10, 0, 0, 0, time.UTC), true},
		{time.Date(2026, 2, 12, 8, 59, 0, 0, time.UTC), false},
		{time.Date(2026, 2, 12, 17, 0, 0, 0, time.UTC), false},
		{time.Date(2026, 2, 12, 16, 59, 0, 0, time.UTC), true},
	}

	for _, tt := range tests {
		if got := IsWithinActiveHours(tt.now, ah); got != tt.expected {
			t.Errorf("At %v, got %v, want %v", tt.now, got, tt.expected)
		}
	}

	// Wrapping window: 22:00 - 06:00
	ahWrap := &ActiveHours{Start: "22:00", End: "06:00", Timezone: "UTC"}
	wrapTests := []struct {
		now      time.Time
		expected bool
	}{
		{time.Date(2026, 2, 12, 23, 0, 0, 0, time.UTC), true},
		{time.Date(2026, 2, 12, 5, 0, 0, 0, time.UTC), true},
		{time.Date(2026, 2, 12, 12, 0, 0, 0, time.UTC), false},
		{time.Date(2026, 2, 12, 21, 59, 0, 0, time.UTC), false},
	}

	for _, tt := range wrapTests {
		if got := IsWithinActiveHours(tt.now, ahWrap); got != tt.expected {
			t.Errorf("At %v (wrap), got %v, want %v", tt.now, got, tt.expected)
		}
	}
}

func TestIsWithinActiveHours_EdgeCases(t *testing.T) {
	// Nil ActiveHours - should return true (always active)
	now := time.Date(2026, 2, 12, 10, 0, 0, 0, time.UTC)
	if got := IsWithinActiveHours(now, nil); !got {
		t.Error("Nil ActiveHours should return true")
	}

	// Empty Start/End - should return false (fail closed)
	emptyAh := &ActiveHours{Start: "", End: "", Timezone: "UTC"}
	if got := IsWithinActiveHours(now, emptyAh); got {
		t.Error("Empty Start/End should return false")
	}

	// Only Start is empty
	partialAh := &ActiveHours{Start: "", End: "17:00", Timezone: "UTC"}
	if got := IsWithinActiveHours(now, partialAh); got {
		t.Error("Empty Start should return false")
	}

	// Only End is empty
	partialAh2 := &ActiveHours{Start: "09:00", End: "", Timezone: "UTC"}
	if got := IsWithinActiveHours(now, partialAh2); got {
		t.Error("Empty End should return false")
	}

	// Same start and end time - should return true (24h)
	sameAh := &ActiveHours{Start: "09:00", End: "09:00", Timezone: "UTC"}
	if got := IsWithinActiveHours(now, sameAh); !got {
		t.Error("Same Start/End should return true (24h)")
	}

	// Invalid time format
	invalidAh := &ActiveHours{Start: "invalid", End: "17:00", Timezone: "UTC"}
	if got := IsWithinActiveHours(now, invalidAh); got {
		t.Error("Invalid time format should return false (fail closed)")
	}
}

func TestIsWithinActiveHours_Timezones(t *testing.T) {
	// Test with Local timezone
	ahLocal := &ActiveHours{Start: "09:00", End: "17:00", Timezone: "Local"}
	now := time.Now()
	got := IsWithinActiveHours(now, ahLocal)
	// Just verify it doesn't panic and returns a bool
	_ = got

	// Test with invalid timezone (should fail closed)
	ahInvalidTz := &ActiveHours{Start: "09:00", End: "17:00", Timezone: "Invalid/Timezone"}
	now = time.Date(2026, 2, 12, 10, 0, 0, 0, time.UTC)
	got = IsWithinActiveHours(now, ahInvalidTz)
	if got {
		t.Error("Invalid timezone should fail closed")
	}
}

func TestActiveHoursLocationRejectsUncacheableTimezoneInputs(t *testing.T) {
	activeHoursLocationCache = sync.Map{}

	loc, ok := activeHoursLocation(" ")
	if !ok || loc != time.UTC {
		t.Fatalf("blank timezone = (%v, %v), want UTC,true", loc, ok)
	}

	uncacheableNames := []string{
		"America/New_York\nInjected",
		strings.Repeat("A", maxActiveHoursTimezoneLength+1),
	}
	for _, name := range uncacheableNames {
		t.Run(name, func(t *testing.T) {
			if loc, ok := activeHoursLocation(name); ok || loc != nil {
				t.Fatalf("activeHoursLocation(%q) = (%v, %v), want nil,false", name, loc, ok)
			}
			if _, cached := activeHoursLocationCache.Load(name); cached {
				t.Fatalf("uncacheable timezone %q was cached", name)
			}
		})
	}

	badTimezone := "Invalid/Timezone"
	if loc, ok := activeHoursLocation(badTimezone); ok || loc != nil {
		t.Fatalf("activeHoursLocation(%q) = (%v, %v), want nil,false", badTimezone, loc, ok)
	}
	if _, cached := activeHoursLocationCache.Load(badTimezone); cached {
		t.Fatalf("failed timezone %q was cached", badTimezone)
	}
	if loc, ok := activeHoursLocation(badTimezone); ok || loc != nil {
		t.Fatalf("repeated activeHoursLocation(%q) = (%v, %v), want nil,false", badTimezone, loc, ok)
	}
	if _, cached := activeHoursLocationCache.Load(badTimezone); cached {
		t.Fatalf("repeated failed timezone %q was cached", badTimezone)
	}

	if loc, ok := activeHoursLocation("UTC"); !ok || loc == nil {
		t.Fatalf("valid timezone did not resolve")
	}
	if _, cached := activeHoursLocationCache.Load("UTC"); !cached {
		t.Fatal("valid timezone was not cached")
	}

	activeHoursLocationCache.Store("Corrupt/Entry", "not a cache entry")
	loc, ok = activeHoursLocation("Corrupt/Entry")
	if ok || loc != time.UTC {
		t.Fatalf("corrupt cached timezone = (%v, %v), want UTC,false", loc, ok)
	}
	if _, cached := activeHoursLocationCache.Load("Corrupt/Entry"); cached {
		t.Fatal("corrupt timezone cache entry was not deleted")
	}
}

func TestNormalizeTimezone(t *testing.T) {
	activeHoursLocationCache = sync.Map{}

	tests := []struct {
		name      string
		timezone  string
		want      string
		wantError bool
	}{
		{name: "blank defaults UTC", timezone: " ", want: "UTC"},
		{name: "valid IANA", timezone: " America/Chicago ", want: "America/Chicago"},
		{name: "local canonicalizes case", timezone: "local", want: "Local"},
		{name: "invalid IANA", timezone: "Invalid/Timezone", wantError: true},
		{name: "whitespace rejected", timezone: "America/New York", wantError: true},
		{name: "too long rejected", timezone: strings.Repeat("A", maxActiveHoursTimezoneLength+1), wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeTimezone(tt.timezone)
			if tt.wantError {
				if err == nil {
					t.Fatalf("NormalizeTimezone(%q) succeeded, want error", tt.timezone)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeTimezone(%q) returned error: %v", tt.timezone, err)
			}
			if got != tt.want {
				t.Fatalf("NormalizeTimezone(%q) = %q, want %q", tt.timezone, got, tt.want)
			}
		})
	}
}

func TestActiveHoursLocationDoesNotCacheDistinctFailedTimezones(t *testing.T) {
	activeHoursLocationCache = sync.Map{}

	for i := range 50 {
		timezone := fmt.Sprintf("Invalid/Timezone%d", i)
		if loc, ok := activeHoursLocation(timezone); ok || loc != nil {
			t.Fatalf("activeHoursLocation(%q) = (%v, %v), want nil,false", timezone, loc, ok)
		}
	}

	cachedEntries := 0
	activeHoursLocationCache.Range(func(_, _ any) bool {
		cachedEntries++
		return true
	})
	if cachedEntries != 0 {
		t.Fatalf("invalid timezone lookups cached %d entries, want 0", cachedEntries)
	}
}

func TestIsWithinActiveHours_WrappingWindowUsesStartDayForPostMidnight(t *testing.T) {
	// Monday-only overnight window: Monday 22:00 to Tuesday 06:00.
	ah := &ActiveHours{
		Start:    "22:00",
		End:      "06:00",
		Timezone: "UTC",
		Days:     []int32{1}, // Monday
	}

	tests := []struct {
		name     string
		now      time.Time
		expected bool
	}{
		{
			name:     "Monday evening is active",
			now:      time.Date(2026, 3, 2, 23, 0, 0, 0, time.UTC), // Monday
			expected: true,
		},
		{
			name:     "Tuesday early morning still belongs to Monday window",
			now:      time.Date(2026, 3, 3, 1, 0, 0, 0, time.UTC), // Tuesday
			expected: true,
		},
		{
			name:     "Monday early morning belongs to Sunday window and is inactive",
			now:      time.Date(2026, 3, 2, 5, 0, 0, 0, time.UTC), // Monday
			expected: false,
		},
		{
			name:     "Tuesday after window end is inactive",
			now:      time.Date(2026, 3, 3, 7, 0, 0, 0, time.UTC), // Tuesday
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsWithinActiveHours(tt.now, ah)
			if got != tt.expected {
				t.Errorf("At %v, got %v, want %v", tt.now, got, tt.expected)
			}
		})
	}
}

func TestParseTime(t *testing.T) {
	tests := []struct {
		input   string
		wantMin int
		wantOk  bool
	}{
		{"09:00", 540, true},
		{"17:30", 1050, true},
		{"00:00", 0, true},
		{"24:00", 1440, true},
		{" 09:00 ", 540, true}, // Trim space
		{"9:00", 540, true},    // Single digit hour works (9:00 = 540 minutes)
		{"invalid", 0, false},
		{"09", 0, false},       // Missing minutes
		{"09:00:00", 0, false}, // Too many parts
		{"25:00", 0, false},    // Hour > 24
		{"24:01", 0, false},    // 24:xx where xx > 0
		{"09:60", 0, false},    // Minute >= 60
		{"-1:00", 0, false},    // Negative hour
		{"09:-1", 0, false},    // Negative minute
		{"", 0, false},         // Empty string
		{":00", 0, false},      // No hour
		{"09:", 0, false},      // No minute
		{"abc:def", 0, false},  // Non-numeric
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			gotMin, gotOk := parseTime(tt.input)
			if gotMin != tt.wantMin || gotOk != tt.wantOk {
				t.Errorf("parseTime(%q) = (%d, %v), want (%d, %v)",
					tt.input, gotMin, gotOk, tt.wantMin, tt.wantOk)
			}
		})
	}
}
