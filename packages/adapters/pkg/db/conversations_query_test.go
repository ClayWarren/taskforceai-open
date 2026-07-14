package db

import (
	"strings"
	"testing"
)

func TestUpdateConversationSharingIsPersonalScoped(t *testing.T) {
	if !strings.Contains(updateConversationSharing, "organization_id IS null") {
		t.Fatal("personal conversation sharing query must not update organization conversations")
	}
}
