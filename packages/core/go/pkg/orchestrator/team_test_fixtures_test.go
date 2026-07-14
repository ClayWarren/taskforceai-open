package orchestrator

import (
	"context"
	"fmt"
)

type mockStore struct {
	teams map[string]*TeamInfo
	tasks map[string][]TeamTask
}

func (m *mockStore) GetTeam(_ context.Context, name string) (*TeamInfo, error) {
	value, ok := m.teams[name]
	if !ok {
		return nil, ErrTeamNotFound
	}
	return value, nil
}

func (m *mockStore) SaveTeam(_ context.Context, team *TeamInfo) error {
	m.teams[team.Name] = team
	return nil
}

func (m *mockStore) ListTeams(context.Context) ([]TeamInfo, error) {
	result := make([]TeamInfo, 0, len(m.teams))
	for _, value := range m.teams {
		result = append(result, *value)
	}
	return result, nil
}

func (m *mockStore) GetTasks(_ context.Context, teamName string) ([]TeamTask, error) {
	return m.tasks[teamName], nil
}

func (m *mockStore) SaveTasks(_ context.Context, teamName string, tasks []TeamTask) error {
	m.tasks[teamName] = tasks
	return nil
}

func (m *mockStore) DeleteTeam(_ context.Context, name string) error {
	delete(m.teams, name)
	return nil
}

func (m *mockStore) FindBySession(_ context.Context, sessionID string) (*TeamInfo, string, string, error) {
	for _, value := range m.teams {
		if value.LeadSessionID == sessionID {
			return value, "lead", "", nil
		}
		for _, member := range value.Members {
			if member.SessionID == sessionID {
				return value, "member", member.Name, nil
			}
		}
	}
	return nil, "", "", nil
}

type failingSaveStore struct {
	*mockStore
	getTeamErr   error
	saveTeamErr  error
	saveTasksErr error
}

func (s *failingSaveStore) GetTeam(ctx context.Context, name string) (*TeamInfo, error) {
	if s.getTeamErr != nil {
		return nil, s.getTeamErr
	}
	return s.mockStore.GetTeam(ctx, name)
}

func (s *failingSaveStore) SaveTeam(ctx context.Context, team *TeamInfo) error {
	if s.saveTeamErr != nil {
		return s.saveTeamErr
	}
	return s.mockStore.SaveTeam(ctx, team)
}

func (s *failingSaveStore) SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	if s.saveTasksErr != nil {
		return s.saveTasksErr
	}
	return s.mockStore.SaveTasks(ctx, teamName, tasks)
}

type erroringTeamStore struct {
	*mockStore
	saveTeamErr  error
	saveTasksErr error
	deleteErr    error
	listErr      error
	getTasksErr  error
}

func (s *erroringTeamStore) SaveTeam(ctx context.Context, team *TeamInfo) error {
	if s.saveTeamErr != nil {
		return s.saveTeamErr
	}
	return s.mockStore.SaveTeam(ctx, team)
}

func (s *erroringTeamStore) SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	if s.saveTasksErr != nil {
		return s.saveTasksErr
	}
	return s.mockStore.SaveTasks(ctx, teamName, tasks)
}

func (s *erroringTeamStore) DeleteTeam(ctx context.Context, name string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.mockStore.DeleteTeam(ctx, name)
}

func (s *erroringTeamStore) ListTeams(ctx context.Context) ([]TeamInfo, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.mockStore.ListTeams(ctx)
}

func (s *erroringTeamStore) GetTasks(ctx context.Context, teamName string) ([]TeamTask, error) {
	if s.getTasksErr != nil {
		return nil, s.getTasksErr
	}
	return s.mockStore.GetTasks(ctx, teamName)
}

type mockBus struct{}

func (*mockBus) Publish(context.Context, string, any) error { return nil }
func (*mockBus) Subscribe(context.Context, string, func(context.Context, map[string]any) error) error {
	return nil
}

type failingBus struct {
	publishErr error
}

func (b *failingBus) Publish(context.Context, string, any) error { return b.publishErr }
func (*failingBus) Subscribe(context.Context, string, func(context.Context, map[string]any) error) error {
	return nil
}

type mockSessions struct{}

func (*mockSessions) InjectMessage(context.Context, string, string, string, string) error { return nil }
func (*mockSessions) AutoWake(context.Context, string) error                              { return nil }
func (*mockSessions) GetSessionInfo(context.Context, string) (string, string, string, error) {
	return "", "", "", nil
}
func (*mockSessions) UpdatePermissions(context.Context, string, string) error { return nil }
func (*mockSessions) RestoreLeadPermissions(context.Context, string, []string) error {
	return nil
}
func (*mockSessions) CancelPrompt(context.Context, string) error  { return nil }
func (*mockSessions) RemoveSession(context.Context, string) error { return nil }
func (*mockSessions) CreateSession(context.Context, string, string, string, []PermissionRule) (string, error) {
	return "ses_child", nil
}
func (*mockSessions) StartPromptLoop(context.Context, string) error { return nil }
func (*mockSessions) GetLastUserMessageModel(context.Context, string) (*ModelInfo, error) {
	return nil, nil
}

type spawnSessions struct {
	mockSessions
	createErr      error
	removeCalls    int
	startLoopErr   error
	startLoopPanic bool
	injectErr      error
	updatePermErr  error
	createCount    int
}

func (s *spawnSessions) CreateSession(context.Context, string, string, string, []PermissionRule) (string, error) {
	if s.createErr != nil {
		return "", s.createErr
	}
	s.createCount++
	return fmt.Sprintf("spawn-session-%d", s.createCount), nil
}
func (s *spawnSessions) RemoveSession(context.Context, string) error {
	s.removeCalls++
	return nil
}
func (s *spawnSessions) InjectMessage(context.Context, string, string, string, string) error {
	return s.injectErr
}
func (s *spawnSessions) UpdatePermissions(context.Context, string, string) error {
	return s.updatePermErr
}
func (s *spawnSessions) StartPromptLoop(context.Context, string) error {
	if s.startLoopPanic {
		panic("prompt loop panic")
	}
	return s.startLoopErr
}

type mockModels struct {
	defaultModel ModelInfo
}

func (*mockModels) ParseModel(model string) (ModelInfo, error) {
	if model == "invalid" {
		return ModelInfo{ProviderID: "p", ModelID: "invalid"}, nil
	}
	return ModelInfo{ProviderID: "p", ModelID: "m"}, nil
}
func (*mockModels) GetModel(_ context.Context, _ string, modelID string) (any, error) {
	if modelID == "invalid" {
		return nil, fmt.Errorf("not found")
	}
	return nil, nil
}
func (m *mockModels) DefaultModel(context.Context) (ModelInfo, error) {
	return m.defaultModel, nil
}
