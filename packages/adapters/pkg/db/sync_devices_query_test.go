package db

import (
	"regexp"
	"strings"
	"testing"
)

func TestUpsertSyncDevicePreservesRevocationOnConflict(t *testing.T) {
	conflictUpdate := regexp.MustCompile(`(?is)ON\s+CONFLICT\s*\(user_id,\s*device_id\)\s*DO\s+UPDATE\s+SET(?P<set>.*?)RETURNING`).
		FindString(upsertSyncDevice)
	if conflictUpdate == "" {
		t.Fatal("UpsertSyncDevice must update existing device heartbeats on conflict")
	}

	if strings.Contains(strings.ToLower(conflictUpdate), "is_revoked") {
		t.Fatal("UpsertSyncDevice must not clear or modify is_revoked during heartbeat")
	}
}
