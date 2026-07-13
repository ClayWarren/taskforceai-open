package pulse

import (
	"testing"
	"time"
)

func TestEventStore(t *testing.T) {
	store := NewEventStore()
	session := "session-1"

	// Test Enqueue and Peek
	store.Enqueue(session, "Event 1", "ctx-1")
	store.Enqueue(session, "Event 2", "ctx-1")
	store.Enqueue(session, "Event 2", "ctx-1") // Duplicate, should be ignored

	peeked := store.Peek(session)
	if len(peeked) != 2 {
		t.Errorf("Expected 2 events, got %d", len(peeked))
	}

	// Test Drain
	drained := store.Drain(session)
	if len(drained) != 2 {
		t.Errorf("Expected 2 drained events, got %d", len(drained))
	}

	if store.HasEvents(session) {
		t.Error("Store should be empty after drain")
	}

	// Test Context Changed
	store.Enqueue(session, "Event 3", "ctx-A")
	if store.IsContextChanged(session, "ctx-A") {
		t.Error("Context should NOT be changed")
	}
	if !store.IsContextChanged(session, "ctx-B") {
		t.Error("Context SHOULD be changed")
	}
}

func TestEventStoreTrimsAndCleansQueues(t *testing.T) {
	store := NewEventStore()
	session := " session-1 "

	store.Enqueue("   ", "ignored", "ctx")
	store.Enqueue(session, "   ", "ctx")
	if store.HasEvents(session) {
		t.Fatal("blank session and text should not create pending events")
	}

	for i := range maxEventsPerSession + 3 {
		store.Enqueue(session, "event-"+time.Unix(int64(i), 0).Format(time.RFC3339), "CTX")
	}

	peeked := store.Peek(session)
	if len(peeked) != maxEventsPerSession {
		t.Fatalf("Expected queue to keep %d events, got %d", maxEventsPerSession, len(peeked))
	}
	if peeked[0] == "event-1970-01-01T00:00:00Z" {
		t.Fatal("Expected oldest event to be trimmed")
	}
	if store.IsContextChanged(session, "ctx") {
		t.Fatal("Context comparison should be normalized")
	}

	store.Cleanup(time.Nanosecond)
	if store.HasEvents(session) {
		t.Fatal("Expected stale queue to be removed")
	}
	if got := store.Peek("missing"); got != nil {
		t.Fatalf("Expected missing queue peek to be nil, got %v", got)
	}
	if got := store.Drain("missing"); got != nil {
		t.Fatalf("Expected missing queue drain to be nil, got %v", got)
	}
	if !store.IsContextChanged("missing", "ctx") {
		t.Fatal("Missing queue should be treated as context changed")
	}
}

func TestEventStoreKeepsSameTextWhenContextChanges(t *testing.T) {
	store := NewEventStore()
	session := "session-1"

	store.Enqueue(session, "same text", "ctx-a")
	store.Enqueue(session, "same text", "ctx-a")
	store.Enqueue(session, "same text", "ctx-b")

	peeked := store.Peek(session)
	if len(peeked) != 2 {
		t.Fatalf("Expected same text in a new context to be queued, got %d events: %v", len(peeked), peeked)
	}
	if store.IsContextChanged(session, "ctx-b") {
		t.Fatal("Context should be updated after queueing the changed-context event")
	}
}
