package orchestrator

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type InMemTeamStore struct {
	teams map[string]*TeamInfo
	tasks map[string][]TeamTask
	mu    sync.RWMutex
}

func cloneTeamInfo(team *TeamInfo) *TeamInfo {
	if team == nil {
		return nil
	}

	cloned := *team
	cloned.Members = append([]TeamMember{}, team.Members...)
	return &cloned
}

func cloneTasks(tasks []TeamTask) []TeamTask {
	if len(tasks) == 0 {
		return []TeamTask{}
	}

	cloned := make([]TeamTask, len(tasks))
	for i, task := range tasks {
		cloned[i] = task
		cloned[i].DependsOn = append([]string(nil), task.DependsOn...)
	}
	return cloned
}

func NewInMemTeamStore() *InMemTeamStore {
	return &InMemTeamStore{
		teams: make(map[string]*TeamInfo),
		tasks: make(map[string][]TeamTask),
	}
}

func (s *InMemTeamStore) GetTeam(ctx context.Context, name string) (*TeamInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	team, ok := s.teams[name]
	if !ok {
		return nil, ErrTeamNotFound
	}
	return cloneTeamInfo(team), nil
}

func (s *InMemTeamStore) SaveTeam(ctx context.Context, team *TeamInfo) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamCopy := cloneTeamInfo(team)
	if teamCopy == nil {
		return fmt.Errorf("team is nil")
	}
	if teamCopy.Created == 0 {
		teamCopy.Created = time.Now().UnixMilli()
	}
	s.teams[teamCopy.Name] = teamCopy
	return nil
}

func (s *InMemTeamStore) ListTeams(ctx context.Context) ([]TeamInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]TeamInfo, 0, len(s.teams))
	for _, t := range s.teams {
		teamCopy := cloneTeamInfo(t)
		if teamCopy != nil {
			list = append(list, *teamCopy)
		}
	}
	return list, nil
}

func (s *InMemTeamStore) GetTasks(ctx context.Context, teamName string) ([]TeamTask, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneTasks(s.tasks[teamName]), nil
}

func (s *InMemTeamStore) SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[teamName] = cloneTasks(tasks)
	return nil
}

func (s *InMemTeamStore) DeleteTeam(ctx context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.teams, name)
	delete(s.tasks, name)
	return nil
}

func (s *InMemTeamStore) FindBySession(ctx context.Context, sessionID string) (*TeamInfo, string, string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, t := range s.teams {
		if t.LeadSessionID == sessionID {
			return cloneTeamInfo(t), "lead", "", nil
		}
		for _, m := range t.Members {
			if m.SessionID == sessionID {
				return cloneTeamInfo(t), "member", m.Name, nil
			}
		}
	}
	return nil, "", "", nil
}
