package remote

import (
	"context"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/TaskForceAI/adapters/pkg/db"
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

func TestRequiredDeviceCredential(t *testing.T) {
	credential := strings.Repeat("a", 43)
	if got, err := requiredDeviceCredential("  " + credential + "  "); err != nil || got != credential {
		t.Fatalf("requiredDeviceCredential returned %q, %v", got, err)
	}
	if _, err := requiredDeviceCredential(""); err == nil {
		t.Fatal("empty device credential should fail")
	}
	if _, err := requiredDeviceCredential("short"); err == nil {
		t.Fatal("short device credential should fail")
	}
	if deviceCredentialHash(credential) == deviceCredentialHash(credential+"x") {
		t.Fatal("different credentials must not share a digest")
	}
}

func TestEveryRemoteDeviceInputRequiresCredential(t *testing.T) {
	inputs := []any{
		targetInput{},
		pairingCodeInput{},
		pairInput{},
		deviceInput{},
		controllerInput{},
		targetPathInput{},
		commandPollInput{},
		commandResultInput{},
		commandResultPollInput{},
	}
	for _, input := range inputs {
		if _, ok := reflect.TypeOf(input).FieldByName("DeviceCredential"); !ok {
			t.Fatalf("%T does not require a device credential", input)
		}
	}
}

func TestClaimAndVerifyDeviceCredentialRejectsSpoofedSecret(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("create database mock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("database expectations: %v", err)
		}
		mock.Close()
	})

	credential := strings.Repeat("a", 64)
	digest := deviceCredentialHash(credential)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO remote_device_credentials")).
		WithArgs("42", "phone-1", digest).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT credential_hash")).
		WithArgs("42", "phone-1").
		WillReturnRows(pgxmock.NewRows([]string{"credential_hash"}).AddRow(digest))
	queries := db.New(mock)
	if err := claimDeviceCredential(context.Background(), queries, "42", "phone-1", credential); err != nil {
		t.Fatalf("claim valid credential: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT credential_hash")).
		WithArgs("42", "phone-1").
		WillReturnRows(pgxmock.NewRows([]string{"credential_hash"}).AddRow(digest))
	if err := verifyDeviceCredential(
		context.Background(),
		queries,
		"42",
		"phone-1",
		strings.Repeat("b", 64),
	); err == nil {
		t.Fatal("spoofed credential should be rejected")
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
