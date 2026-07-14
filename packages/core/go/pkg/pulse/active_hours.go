package pulse

import (
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"
)

// ActiveHours defines a window of time when an agent is allowed to be active.
type ActiveHours struct {
	Start    string  // e.g. "09:00"
	End      string  // e.g. "17:00" (can be "24:00" or "00:00")
	Timezone string  // e.g. "America/New_York" or "Local"
	Days     []int32 // 0=Sunday, 1=Monday, ..., 6=Saturday
}

type locationCacheEntry struct {
	loc *time.Location
	err error
}

var activeHoursLocationCache sync.Map

const maxActiveHoursTimezoneLength = 128

// IsWithinActiveHours checks if the given time is within the specified active hours.
func IsWithinActiveHours(now time.Time, ah *ActiveHours) bool {
	if ah == nil {
		return true // Default to always active
	}

	// Resolve Timezone
	loc, ok := activeHoursLocation(ah.Timezone)
	if !ok {
		return false
	}

	localTime := now.In(loc)
	currentDay := int32(localTime.Weekday()) // #nosec G115

	if ah.Start == "" || ah.End == "" {
		slog.Warn("Pulse active hours missing start or end, failing closed", "start", ah.Start, "end", ah.End)
		return false
	}

	startMin, ok1 := parseTime(ah.Start)
	endMin, ok2 := parseTime(ah.End)
	if !ok1 || !ok2 {
		slog.Warn("Pulse invalid active hours format, failing closed", "start", ah.Start, "end", ah.End)
		return false
	}

	currentMinutes := localTime.Hour()*60 + localTime.Minute()
	wrapsMidnight := endMin < startMin
	withinWindow := false

	switch {
	case startMin == endMin:
		withinWindow = true // Same start/end means 24h
	case !wrapsMidnight:
		// Standard window: 09:00 - 17:00
		withinWindow = currentMinutes >= startMin && currentMinutes < endMin
	default:
		// Wrapping window: 22:00 - 06:00
		withinWindow = currentMinutes >= startMin || currentMinutes < endMin
	}

	if !withinWindow {
		return false
	}

	if len(ah.Days) == 0 {
		return true
	}

	effectiveDay := currentDay
	// For wrapping windows, post-midnight times belong to the previous day's window.
	if wrapsMidnight && currentMinutes < endMin {
		effectiveDay = int32((int(currentDay) + 6) % 7) // #nosec G115
	}
	return slices.Contains(ah.Days, effectiveDay)
}

func activeHoursLocation(timezone string) (*time.Location, bool) {
	normalizedTimezone, err := normalizeTimezoneName(timezone)
	if err != nil {
		slog.Warn("Pulse invalid timezone name, failing closed", "timezone", timezone, "error", err)
		return nil, false
	}
	if strings.TrimSpace(timezone) == "" {
		return time.UTC, true
	}
	if strings.EqualFold(normalizedTimezone, "local") {
		return time.Local, true
	}
	if cached, ok := activeHoursLocationCache.Load(normalizedTimezone); ok {
		entry, ok := cached.(locationCacheEntry)
		if !ok {
			activeHoursLocationCache.Delete(normalizedTimezone)
			return time.UTC, false
		}
		return entry.loc, entry.err == nil && entry.loc != nil
	}

	loc, err := time.LoadLocation(normalizedTimezone)
	if err != nil {
		slog.Warn("Pulse failed to load timezone, failing closed", "timezone", normalizedTimezone, "error", err)
		return nil, false
	}
	activeHoursLocationCache.Store(normalizedTimezone, locationCacheEntry{loc: loc})
	return loc, true
}

// NormalizeTimezone trims and validates an agent timezone against the runtime
// IANA timezone database. Blank input preserves the historical UTC default.
func NormalizeTimezone(timezone string) (string, error) {
	timezone, err := normalizeTimezoneName(timezone)
	if err != nil {
		return "", err
	}
	if strings.EqualFold(timezone, "local") {
		return "Local", nil
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return "", fmt.Errorf("invalid timezone %q", timezone)
	}
	return timezone, nil
}

// NormalizeActiveHoursTime trims and validates a clock value using the same
// rules as the pulse scheduler. The special value 24:00 is accepted as the end
// of a day; other 24-hour values are rejected.
func NormalizeActiveHoursTime(value string) (string, error) {
	value = strings.TrimSpace(value)
	if _, ok := parseTime(value); !ok {
		return "", fmt.Errorf("invalid active-hours time %q: expected HH:MM", value)
	}
	return value, nil
}

func normalizeTimezoneName(timezone string) (string, error) {
	timezone = strings.TrimSpace(timezone)
	if timezone == "" {
		return "UTC", nil
	}
	if len(timezone) > maxActiveHoursTimezoneLength || strings.ContainsAny(timezone, "\x00\r\n\t ") {
		return "", fmt.Errorf("timezone must be an IANA name no longer than %d bytes", maxActiveHoursTimezoneLength)
	}
	if strings.EqualFold(timezone, "local") {
		return "Local", nil
	}
	return timezone, nil
}

func parseTime(tStr string) (int, bool) {
	tStr = strings.TrimSpace(tStr)
	colon := strings.IndexByte(tStr, ':')
	if colon <= 0 || colon == len(tStr)-1 || strings.IndexByte(tStr[colon+1:], ':') >= 0 {
		return 0, false
	}
	h, ok := parseClockPart(tStr[:colon])
	if !ok {
		return 0, false
	}
	m, ok := parseClockPart(tStr[colon+1:])
	if !ok {
		return 0, false
	}
	if h < 0 || h > 24 || m < 0 || m > 59 {
		return 0, false
	}
	if h == 24 && m != 0 {
		return 0, false
	}
	return h*60 + m, true
}

func parseClockPart(part string) (int, bool) {
	value := 0
	for _, ch := range part {
		if ch < '0' || ch > '9' {
			return 0, false
		}
		value = value*10 + int(ch-'0')
	}
	return value, true
}
