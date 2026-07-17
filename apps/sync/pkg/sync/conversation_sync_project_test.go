package sync

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestConversationPayloadFromRecordPreservesProjectID(t *testing.T) {
	projectID := int32(17)
	payload := conversationPayloadFromRecord(&ConversationRecord{
		ID:        42,
		ProjectID: &projectID,
	})

	require.NotNil(t, payload.ProjectID)
	require.Equal(t, projectID, *payload.ProjectID)
}
