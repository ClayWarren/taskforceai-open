package remote

import (
	"strings"
	"testing"
)

func TestPairingCodeFormatAndNormalization(t *testing.T) {
	first, err := pairingCode()
	if err != nil {
		t.Fatalf("pairingCode returned error: %v", err)
	}
	second, err := pairingCode()
	if err != nil {
		t.Fatalf("pairingCode returned error: %v", err)
	}
	if len(first) != 9 || first[4] != '-' {
		t.Fatalf("unexpected pairing code format: %q", first)
	}
	if normalizeCode(strings.ToLower(first)) != strings.ReplaceAll(first, "-", "") {
		t.Fatalf("pairing code normalization failed: %q", first)
	}
	if first == second {
		t.Fatal("pairing codes unexpectedly matched")
	}
}

func TestRequiredDeviceID(t *testing.T) {
	if got, err := requiredDeviceID("  phone-1  "); err != nil || got != "phone-1" {
		t.Fatalf("requiredDeviceID returned %q, %v", got, err)
	}
	if _, err := requiredDeviceID(""); err == nil {
		t.Fatal("empty device ID should fail")
	}
	if _, err := requiredDeviceID(strings.Repeat("x", 201)); err == nil {
		t.Fatal("oversized device ID should fail")
	}
}

func TestRelayKeysAreAccountAndDeviceScoped(t *testing.T) {
	if got := commandStream("42", "mac-1"); got != "remote:commands:42:mac-1" {
		t.Fatalf("unexpected command stream: %q", got)
	}
	if got := resultKey("42", "mac-1", "cmd-1"); got != "remote:result:42:mac-1:cmd-1" {
		t.Fatalf("unexpected result key: %q", got)
	}
}
