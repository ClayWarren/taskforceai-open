package run

import (
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
