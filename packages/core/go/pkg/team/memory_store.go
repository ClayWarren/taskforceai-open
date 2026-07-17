package team

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type InMemoryStore struct {
	teams map[string]*Team
	tasks map[string][]Task
	mu    sync.RWMutex
}

func cloneTeamInfo(team *Team) *Team {
	if team == nil {
		return nil
	}

	cloned := *team
	cloned.Members = append([]Member{}, team.Members...)
	return &cloned
}

func cloneTasks(tasks []Task) []Task {
	if len(tasks) == 0 {
		return []Task{}
	}

	cloned := make([]Task, len(tasks))
	for i, task := range tasks {
		cloned[i] = task
		cloned[i].DependsOn = append([]string(nil), task.DependsOn...)
	}
	return cloned
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{
		teams: make(map[string]*Team),
		tasks: make(map[string][]Task),
	}
}

func (s *InMemoryStore) GetTeam(ctx context.Context, name string) (*Team, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	team, ok := s.teams[name]
	if !ok {
		return nil, ErrTeamNotFound
	}
	return cloneTeamInfo(team), nil
}

func (s *InMemoryStore) SaveTeam(ctx context.Context, team *Team) error {
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

func (s *InMemoryStore) ListTeams(ctx context.Context) ([]Team, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]Team, 0, len(s.teams))
	for _, t := range s.teams {
		teamCopy := cloneTeamInfo(t)
		if teamCopy != nil {
			list = append(list, *teamCopy)
		}
	}
	return list, nil
}

func (s *InMemoryStore) GetTasks(ctx context.Context, teamName string) ([]Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneTasks(s.tasks[teamName]), nil
}

func (s *InMemoryStore) SaveTasks(ctx context.Context, teamName string, tasks []Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[teamName] = cloneTasks(tasks)
	return nil
}

func (s *InMemoryStore) DeleteTeam(ctx context.Context, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.teams, name)
	delete(s.tasks, name)
	return nil
}

func (s *InMemoryStore) FindBySession(ctx context.Context, sessionID string) (*Team, string, string, error) {
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
