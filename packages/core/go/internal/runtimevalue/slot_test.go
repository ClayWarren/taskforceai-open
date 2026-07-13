package runtimevalue

import "testing"

type slotValue interface{ value() string }

type fixedSlotValue string

func (v fixedSlotValue) value() string { return string(v) }

func TestSlotRestoreAndNilFallback(t *testing.T) {
	slot := New[slotValue](fixedSlotValue("fallback"))
	restore := slot.Set(fixedSlotValue("installed"))
	if got := slot.Current().value(); got != "installed" {
		t.Fatalf("expected installed value, got %q", got)
	}
	restore()
	restore = slot.Set(nil)
	if got := slot.Current().value(); got != "fallback" {
		t.Fatalf("expected nil set to install fallback, got %q", got)
	}
	restore()
	slot.value = nil
	if got := slot.Current().value(); got != "fallback" {
		t.Fatalf("expected fallback value, got %q", got)
	}
}
