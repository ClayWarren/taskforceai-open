package orchestrator

import (
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
)

func TestInMemoryTeamInbox(t *testing.T) {
	inbox := NewInMemoryTeamInbox()
	msg := agent.InboxMessage{
		ID:   "1",
		From: "lead",
		Text: "hello",
		Read: true,
	}

	if err := inbox.Write("team", "worker", msg); err != nil {
		t.Fatalf("write message: %v", err)
	}

	all, err := inbox.ReadAll("team", "worker")
	if err != nil {
		t.Fatalf("read all: %v", err)
	}
	if len(all) != 1 || all[0].Read {
		t.Fatalf("expected one unread stored message, got %#v", all)
	}

	unread, err := inbox.Unread("team", "worker")
	if err != nil {
		t.Fatalf("read unread: %v", err)
	}
	if len(unread) != 1 {
		t.Fatalf("expected one unread message, got %#v", unread)
	}

	read, err := inbox.MarkRead("team", "worker")
	if err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if len(read) != 1 || !read[0].Read {
		t.Fatalf("expected one read receipt, got %#v", read)
	}

	unread, err = inbox.Unread("team", "worker")
	if err != nil {
		t.Fatalf("read unread after mark read: %v", err)
	}
	if len(unread) != 0 {
		t.Fatalf("expected no unread messages, got %#v", unread)
	}

	if err := inbox.Remove("team", "worker"); err != nil {
		t.Fatalf("remove inbox: %v", err)
	}
	all, err = inbox.ReadAll("team", "worker")
	if err != nil {
		t.Fatalf("read all after remove: %v", err)
	}
	if len(all) != 0 {
		t.Fatalf("expected removed inbox to be empty, got %#v", all)
	}
}

func TestInMemoryTeamInboxRejectsInvalidNames(t *testing.T) {
	inbox := NewInMemoryTeamInbox()
	err := inbox.Write("../team", "worker", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"})
	if err == nil || !strings.Contains(err.Error(), "invalid team name") {
		t.Fatalf("expected invalid team name, got %v", err)
	}

	_, err = inbox.ReadAll("team", "../worker")
	if err == nil || !strings.Contains(err.Error(), "invalid agent name") {
		t.Fatalf("expected invalid agent name, got %v", err)
	}

	_, err = inbox.MarkRead("team", "../worker")
	if err == nil || !strings.Contains(err.Error(), "invalid agent name") {
		t.Fatalf("expected invalid agent name from mark read, got %v", err)
	}

	err = inbox.Remove("../team", "worker")
	if err == nil || !strings.Contains(err.Error(), "invalid team name") {
		t.Fatalf("expected invalid team name from remove, got %v", err)
	}
}

func TestInMemoryTeamInboxEdges(t *testing.T) {
	inbox := &InMemoryTeamInbox{}
	if err := inbox.Write("team", "worker", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"}); err != nil {
		t.Fatalf("write with nil map: %v", err)
	}

	key, err := teamInboxKey("team", "full")
	if err != nil {
		t.Fatalf("team inbox key: %v", err)
	}
	inbox.messages[key] = make([]agent.InboxMessage, MaxInboxMessages)
	if err := inbox.Write("team", "full", agent.InboxMessage{ID: "overflow"}); err == nil || !strings.Contains(err.Error(), "maximum") {
		t.Fatalf("expected full inbox error, got %v", err)
	}

	inbox.messages[key][0] = agent.InboxMessage{ID: "read", Read: true}
	inbox.messages[key][1] = agent.InboxMessage{ID: "unread"}
	read, err := inbox.MarkRead("team", "full")
	if err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if len(read) != MaxInboxMessages-1 {
		t.Fatalf("expected already-read message to be skipped, got %d read", len(read))
	}
}

func TestValidateInboxName(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "plain", value: "agent", wantErr: false},
		{name: "dash", value: "agent-1", wantErr: false},
		{name: "blank", value: " ", wantErr: true},
		{name: "dot", value: ".", wantErr: true},
		{name: "dot dot", value: "..", wantErr: true},
		{name: "slash", value: "team/agent", wantErr: true},
		{name: "backslash", value: `team\agent`, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateInboxName(tt.value, "agent")
			if tt.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}
