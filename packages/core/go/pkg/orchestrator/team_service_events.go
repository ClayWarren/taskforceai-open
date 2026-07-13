package orchestrator

import (
	"context"
	"fmt"
	"log/slog"
)

func (s *TeamService) Init(ctx context.Context) {
	if err := s.bus.Subscribe(ctx, "team.member.status", s.handleMemberStatusChanged); err != nil {
		slog.Warn("bus.Subscribe team.member.status failed", "error", err)
	}
	if err := s.bus.Subscribe(ctx, "team.cleaned", s.handleTeamCleaned); err != nil {
		slog.Warn("bus.Subscribe team.cleaned failed", "error", err)
	}
}

func (s *TeamService) handleMemberStatusChanged(ctx context.Context, props map[string]any) error {
	status, ok := props["status"].(string)
	if !ok {
		return fmt.Errorf("missing or invalid 'status' in event properties")
	}
	if status != string(MemberStatusShutdown) {
		return nil
	}

	teamName, ok := props["teamName"].(string)
	if !ok {
		return fmt.Errorf("missing or invalid 'teamName' in event properties")
	}
	team, err := s.Get(ctx, teamName)
	if err != nil {
		return err
	}

	if len(team.Members) == 0 {
		return nil
	}

	for _, m := range team.Members {
		if m.Status != MemberStatusShutdown {
			return nil
		}
	}

	return s.Cleanup(ctx, teamName)
}

func (s *TeamService) handleTeamCleaned(ctx context.Context, props map[string]any) error {
	delegate, ok := props["delegate"].(bool)
	if !ok {
		return fmt.Errorf("missing or invalid 'delegate' in event properties")
	}
	if !delegate {
		return nil
	}

	leadSessionID, ok := props["leadSessionID"].(string)
	if !ok {
		return fmt.Errorf("missing or invalid 'leadSessionID' in event properties")
	}
	return s.sessions.RestoreLeadPermissions(ctx, leadSessionID, WRITE_TOOLS)
}
