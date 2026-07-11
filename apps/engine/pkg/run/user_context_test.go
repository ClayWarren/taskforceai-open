package run

import (
	"context"

	"github.com/TaskForceAI/go-engine/pkg/integrations"
)

func fetchUserContext(userID int, projectID *int32) ([]string, *integrations.GoogleDriveClient, string, bool, bool, string) {
	userContext, err := loadRunUserContext(context.Background(), UserContextLoadInput{
		UserID:    int32(userID), // #nosec G115
		ProjectID: projectID,
	})
	if err != nil {
		return nil, nil, "", true, false, ""
	}
	return userContext.Memories,
		userContext.DriveClient,
		userContext.ProjectInstructions,
		userContext.MemoryEnabled,
		userContext.TrustLayerEnabled,
		userContext.GithubToken
}
