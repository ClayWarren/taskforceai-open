package utils

import (
	"testing"
)

func TestDeepClone(t *testing.T) {
	type user struct {
		Name string
		Meta map[string]string
	}

	orig := user{
		Name: "Alice",
		Meta: map[string]string{"key": "val"},
	}

	clone := DeepClone(orig)

	if clone.Name != orig.Name {
		t.Errorf("expected %s, got %s", orig.Name, clone.Name)
	}

	// Modify clone and ensure original is unchanged
	clone.Name = "Bob"
	clone.Meta["key"] = "changed"

	if orig.Name != "Alice" {
		t.Errorf("original name changed to %s", orig.Name)
	}
	if orig.Meta["key"] != "val" {
		t.Errorf("original meta changed to %s", orig.Meta["key"])
	}
}

func TestDeepClone_Error(t *testing.T) {
	// Channels cannot be marshaled to JSON
	ch := make(chan int)
	clone := DeepClone(ch)
	if clone != nil {
		t.Errorf("expected zero-value channel to be returned on error")
	}
}

func TestDeepClone_ErrorDoesNotAliasOriginalPointer(t *testing.T) {
	type payload struct {
		Name string
		Ch   chan int
	}

	orig := &payload{Name: "before", Ch: make(chan int)}
	clone := DeepClone(orig)
	if clone != nil {
		t.Fatalf("expected nil clone on error, got %#v", clone)
	}

	orig.Name = "after"
	if orig.Name != "after" {
		t.Fatalf("expected original mutation to remain isolated")
	}
}

type badUnmarshal struct {
	Value string
}

func (b badUnmarshal) MarshalJSON() ([]byte, error) {
	return []byte(`{"value":123}`), nil
}

func TestDeepClone_UnmarshalErrorReturnsZeroValue(t *testing.T) {
	clone := DeepClone(badUnmarshal{Value: "x"})
	if clone.Value != "" {
		t.Fatalf("expected zero value on unmarshal error, got %#v", clone)
	}
}
