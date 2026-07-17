package run

import (
	coreorchestrator "github.com/TaskForceAI/core/pkg/orchestrator"
	coreteam "github.com/TaskForceAI/core/pkg/team"
	teamservice "github.com/TaskForceAI/go-engine/pkg/run/internal/teamservice"
)

func GetTeamService() *coreteam.Service {
	return teamservice.GetTeamService()
}

var SetTeamService = teamservice.SetTeamService

func GetTeamInbox() coreteam.InboxStore {
	return teamservice.GetTeamInbox()
}

func GetTeamSessionManager() *coreorchestrator.TeamSessionManager {
	return teamservice.GetTeamSessionManager()
}
