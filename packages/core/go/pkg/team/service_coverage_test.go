package team

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type shutdownSessions struct {
	mockSessions
	cancelErr error
}

func (s *shutdownSessions) CancelPrompt(context.Context, string) error { return s.cancelErr }

func TestServiceWaitAndRestrictLeadPermissions(t *testing.T) {
	sessions := &spawnSessions{}
	service := NewService(nil, nil, sessions, nil, nil)
	service.Wait()
	require.NoError(t, service.RestrictLeadPermissions(context.Background(), "lead"))

	sessions.updatePermErr = errors.New("permission update failed")
	require.ErrorContains(t, service.RestrictLeadPermissions(context.Background(), "lead"), "permission update failed")
}

func TestServiceRequestMemberShutdownGuardsAndSuccess(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{teams: map[string]*Team{}, tasks: map[string][]Task{}}
	inbox := newTestTeamInbox(t.TempDir())
	service := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})

	require.ErrorIs(t, service.RequestMemberShutdown(ctx, "missing", "worker", ""), ErrTeamNotFound)
	require.NoError(t, store.SaveTeam(ctx, &Team{Name: "team", LeadSessionID: "lead", Members: []Member{{Name: "done", Status: MemberStatusShutdown}, {Name: "worker", SessionID: "worker-session", Status: MemberStatusReady}}}))
	require.ErrorIs(t, service.RequestMemberShutdown(ctx, "team", "missing", ""), ErrMemberNotFound)
	require.NoError(t, service.RequestMemberShutdown(ctx, "team", "done", ""))
	require.NoError(t, service.RequestMemberShutdown(ctx, "team", "worker", ""))

	team, err := store.GetTeam(ctx, "team")
	require.NoError(t, err)
	assert.Equal(t, MemberStatusShutdownRequested, findMember(team.Members, "worker").Status)
}

func TestServiceRequestMemberShutdownLogsNonFatalFailures(t *testing.T) {
	ctx := context.Background()
	base := &mockStore{teams: map[string]*Team{
		"team": {Name: "team", LeadSessionID: "lead", Members: []Member{{Name: "worker", SessionID: "worker-session", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning}}},
	}, tasks: map[string][]Task{}}
	store := &failingSaveStore{mockStore: base, saveTeamErr: errors.New("transition failed")}
	inbox := newTestTeamInbox(t.TempDir())
	inbox.writeErr = errors.New("send failed")
	sessions := &shutdownSessions{cancelErr: errors.New("cancel failed")}
	service := NewService(store, inbox, sessions, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})

	require.NoError(t, service.RequestMemberShutdown(ctx, "team", "worker", "stop now"))
}

func TestServiceRequestMemberShutdownLogsCancelFailure(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{teams: map[string]*Team{
		"team": {Name: "team", LeadSessionID: "lead", Members: []Member{{Name: "worker", SessionID: "worker-session", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning}}},
	}, tasks: map[string][]Task{}}
	sessions := &shutdownSessions{cancelErr: errors.New("cancel failed")}
	service := NewService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})

	require.NoError(t, service.RequestMemberShutdown(ctx, "team", "worker", "stop now"))
}

func TestAdditionalTeamErrorPaths(t *testing.T) {
	ctx := context.Background()

	store := &erroringTeamStore{
		mockStore:    &mockStore{teams: map[string]*Team{}, tasks: map[string][]Task{}},
		saveTasksErr: errors.New("save tasks failed"),
		deleteErr:    errors.New("delete failed"),
	}
	service := NewService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
	_, err := service.Create(ctx, "rollback", "lead", false)
	require.ErrorContains(t, err, "save tasks failed")

	store.getTasksErr = errors.New("get tasks failed")
	_, err = service.ClaimTask(ctx, "rollback", "task", "worker")
	require.ErrorContains(t, err, "get tasks failed")

	plainStore := &mockStore{teams: map[string]*Team{"team": {Name: "team"}}, tasks: map[string][]Task{}}
	service = NewService(plainStore, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
	require.ErrorIs(t, service.ApprovePlan(ctx, "team", "missing", true, ""), ErrMemberNotFound)
}

func TestSpawnMemberContinuesWhenClaimTaskFails(t *testing.T) {
	ctx := context.Background()
	store := &erroringTeamStore{
		mockStore:   &mockStore{teams: map[string]*Team{}, tasks: map[string][]Task{}},
		getTasksErr: errors.New("get tasks failed"),
	}
	service := NewService(store, newTestTeamInbox(t.TempDir()), &spawnSessions{}, &mockModels{}, &mockBus{})
	require.NoError(t, store.SaveTeam(ctx, &Team{Name: "team", LeadSessionID: "lead"}))
	input := SpawnInput{TeamName: "team", Name: "worker", ParentSessionID: "lead", Prompt: "work", ClaimTask: "task-1"}
	input.Agent.Name = "agent"
	input.Model.ProviderID = "provider"
	input.Model.ModelID = "model"

	_, _, err := service.SpawnMember(ctx, input)
	require.NoError(t, err)
	service.Wait()
}
