package orchestrator

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInMemTeamStore(t *testing.T) {
	ctx := context.Background()
	store := NewInMemTeamStore()

	// 1. Get non-existent
	_, err := store.GetTeam(ctx, "non-existent")
	require.ErrorIs(t, err, ErrTeamNotFound)

	// 2. Save nil team
	err = store.SaveTeam(ctx, nil)
	require.ErrorContains(t, err, "team is nil")

	// 3. Save valid team
	team := &TeamInfo{
		Name:          "team1",
		LeadSessionID: "sessionA",
		Members: []TeamMember{
			{Name: "member1", SessionID: "sessionB"},
		},
	}
	err = store.SaveTeam(ctx, team)
	require.NoError(t, err)

	// Verify Created was populated
	savedTeam, err := store.GetTeam(ctx, "team1")
	require.NoError(t, err)
	assert.Equal(t, "team1", savedTeam.Name)
	assert.NotZero(t, savedTeam.Created)

	// Modify savedTeam to ensure it was cloned and doesn't mutate store
	savedTeam.Name = "temp"
	savedTeam.Members[0].Name = "mutated"

	cleanTeam, err := store.GetTeam(ctx, "team1")
	require.NoError(t, err)
	assert.Equal(t, "team1", cleanTeam.Name)
	assert.Equal(t, "member1", cleanTeam.Members[0].Name)

	// 4. ListTeams
	teams, err := store.ListTeams(ctx)
	require.NoError(t, err)
	assert.Len(t, teams, 1)

	// 5. Save and Get Tasks
	tasks := []TeamTask{
		{ID: "task1", Content: "do work", DependsOn: []string{"task0"}},
	}
	err = store.SaveTasks(ctx, "team1", tasks)
	require.NoError(t, err)

	savedTasks, err := store.GetTasks(ctx, "team1")
	require.NoError(t, err)
	require.Len(t, savedTasks, 1)
	assert.Equal(t, "task1", savedTasks[0].ID)

	// Modify to test clone
	savedTasks[0].DependsOn[0] = "mutated"
	cleanTasks, _ := store.GetTasks(ctx, "team1")
	assert.Equal(t, "task0", cleanTasks[0].DependsOn[0])

	// 6. FindBySession
	// lead session
	foundTeam, role, memberName, err := store.FindBySession(ctx, "sessionA")
	require.NoError(t, err)
	assert.Equal(t, "team1", foundTeam.Name)
	assert.Equal(t, "lead", role)
	assert.Empty(t, memberName)

	// member session
	foundTeam, role, memberName, err = store.FindBySession(ctx, "sessionB")
	require.NoError(t, err)
	assert.Equal(t, "team1", foundTeam.Name)
	assert.Equal(t, "member", role)
	assert.Equal(t, "member1", memberName)

	// non-existent session
	foundTeam, role, _, err = store.FindBySession(ctx, "sessionC")
	require.NoError(t, err)
	assert.Nil(t, foundTeam)
	assert.Empty(t, role)

	// 7. Delete
	err = store.DeleteTeam(ctx, "team1")
	require.NoError(t, err)

	_, err = store.GetTeam(ctx, "team1")
	require.ErrorIs(t, err, ErrTeamNotFound)

	listed, _ := store.ListTeams(ctx)
	assert.Empty(t, listed)

	// Empty slices clone test
	clonedInfo := cloneTeamInfo(&TeamInfo{Members: nil})
	assert.NotNil(t, clonedInfo.Members)
	assert.Empty(t, clonedInfo.Members)

	clonedTasks := cloneTasks([]TeamTask{{DependsOn: nil}})
	assert.Len(t, clonedTasks, 1)
	assert.Nil(t, clonedTasks[0].DependsOn)
}
