package orchestrator

import "github.com/TaskForceAI/core/pkg/agent"

// gapOrchestratorDeps builds the OrchestratorDeps fixture used across the
// orchestrator tests. A nil client yields a fresh MockLLMClient. An optional
// budget limit is passed to NewBudgetManager (nil when omitted).
func gapOrchestratorDeps(client agent.ILLMClient, budgetLimit ...*int) OrchestratorDeps {
	if client == nil {
		client = new(MockLLMClient)
	}
	var budget *int
	if len(budgetLimit) > 0 {
		budget = budgetLimit[0]
	}
	return OrchestratorDeps{
		Client:       client,
		Budget:       NewBudgetManager(budget),
		UsageTracker: NewUsageTracker(),
	}
}

type testTeamInboxStore struct {
	*InMemoryTeamInbox
	writeErr   error
	readAllErr error
	unreadErr  error
	markErr    error
	removeErr  error
}

func newTestTeamInbox(_ string) *testTeamInboxStore {
	return &testTeamInboxStore{InMemoryTeamInbox: NewInMemoryTeamInbox()}
}

func (i *testTeamInboxStore) Write(teamName, to string, msg agent.InboxMessage) error {
	if i.writeErr != nil {
		return i.writeErr
	}
	return i.InMemoryTeamInbox.Write(teamName, to, msg)
}

func (i *testTeamInboxStore) ReadAll(teamName, agentName string) ([]agent.InboxMessage, error) {
	if i.readAllErr != nil {
		return nil, i.readAllErr
	}
	return i.InMemoryTeamInbox.ReadAll(teamName, agentName)
}

func (i *testTeamInboxStore) Unread(teamName, agentName string) ([]agent.InboxMessage, error) {
	if i.unreadErr != nil {
		return nil, i.unreadErr
	}
	return i.InMemoryTeamInbox.Unread(teamName, agentName)
}

func (i *testTeamInboxStore) MarkRead(teamName, agentName string) ([]agent.InboxMessage, error) {
	if i.markErr != nil {
		return nil, i.markErr
	}
	return i.InMemoryTeamInbox.MarkRead(teamName, agentName)
}

func (i *testTeamInboxStore) Remove(teamName, agentName string) error {
	if i.removeErr != nil {
		return i.removeErr
	}
	return i.InMemoryTeamInbox.Remove(teamName, agentName)
}
