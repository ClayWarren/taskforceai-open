package team

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

func (s *Service) Create(ctx context.Context, name string, leadSessionID string, delegate bool) (*Team, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing, err := s.store.GetTeam(ctx, name)
	if err != nil && !errors.Is(err, ErrTeamNotFound) {
		return nil, err
	}
	if existing != nil {
		return nil, ErrTeamAlreadyExists
	}

	team := &Team{
		Name:          name,
		LeadSessionID: leadSessionID,
		Members:       []Member{},
		Created:       time.Now().UnixNano() / int64(time.Millisecond),
		Delegate:      delegate,
	}

	if err := s.store.SaveTeam(ctx, team); err != nil {
		return nil, err
	}

	if err := s.store.SaveTasks(ctx, name, []Task{}); err != nil {
		if deleteErr := s.store.DeleteTeam(ctx, name); deleteErr != nil {
			slog.Warn("Failed to roll back team after task initialization failure", "teamName", name, "error", deleteErr)
		}
		return nil, err
	}

	return team, nil
}

func (s *Service) Get(ctx context.Context, name string) (*Team, error) {
	team, err := s.store.GetTeam(ctx, name)
	if err != nil {
		return nil, err
	}
	if team == nil {
		return nil, fmt.Errorf("team %q not found", name)
	}
	normalized := NormalizeTeam(*team)
	return &normalized, nil
}

func (s *Service) ListTeams(ctx context.Context) ([]Team, error) {
	return s.store.ListTeams(ctx)
}

func (s *Service) AddMember(ctx context.Context, teamName string, member Member) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	team, err := s.Get(ctx, teamName)
	if err != nil {
		return err
	}

	lowerName := strings.ToLower(strings.TrimSpace(member.Name))
	if lowerName == "lead" {
		return fmt.Errorf("name 'lead' is reserved")
	}

	if len(team.Members) >= MaxTeamMembers {
		return fmt.Errorf("team %q has reached the maximum of %d members", teamName, MaxTeamMembers)
	}

	for _, m := range team.Members {
		if m.Name == member.Name {
			return fmt.Errorf("teammate %q already exists", member.Name)
		}
		if m.SessionID == member.SessionID {
			return fmt.Errorf("session %q already registered", member.SessionID)
		}
	}

	team.Members = append(team.Members, member)
	return s.store.SaveTeam(ctx, team)
}

func (s *Service) SetDelegate(ctx context.Context, teamName string, delegate bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	team, err := s.store.GetTeam(ctx, teamName)
	if err != nil {
		return err
	}
	team.Delegate = delegate
	return s.store.SaveTeam(ctx, team)
}

func (s *Service) FindBySession(ctx context.Context, sessionID string) (*Team, string, string, error) {
	return s.store.FindBySession(ctx, sessionID)
}

func (s *Service) Cleanup(ctx context.Context, teamName string) error {
	team, err := s.Get(ctx, teamName)
	if err != nil {
		return err
	}

	for _, m := range team.Members {
		if m.Status != MemberStatusShutdown {
			return fmt.Errorf("cannot clean up team: member %q is not shutdown", m.Name)
		}
	}

	for _, m := range team.Members {
		if err := s.inbox.Remove(teamName, m.Name); err != nil {
			slog.Warn("Failed to remove member inbox", "teamName", teamName, "memberName", m.Name, "error", err)
		}
	}
	if err := s.inbox.Remove(teamName, "lead"); err != nil {
		slog.Warn("Failed to remove lead inbox", "teamName", teamName, "error", err)
	}

	if err := s.store.DeleteTeam(ctx, teamName); err != nil {
		return err
	}

	if pubErr := s.bus.Publish(ctx, "team.cleaned", map[string]any{
		"teamName":      teamName,
		"leadSessionID": team.LeadSessionID,
		"delegate":      team.Delegate,
	}); pubErr != nil {
		slog.Warn("bus.Publish team.cleaned failed", "error", pubErr)
	}

	return nil
}
