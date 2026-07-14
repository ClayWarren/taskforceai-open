package team

type testTeamInboxStore struct {
	*InMemoryInbox
	writeErr   error
	readAllErr error
	unreadErr  error
	markErr    error
	removeErr  error
}

func newTestTeamInbox(_ string) *testTeamInboxStore {
	return &testTeamInboxStore{InMemoryInbox: NewInMemoryInbox()}
}

func (i *testTeamInboxStore) Write(teamName, to string, msg InboxMessage) error {
	if i.writeErr != nil {
		return i.writeErr
	}
	return i.InMemoryInbox.Write(teamName, to, msg)
}

func (i *testTeamInboxStore) ReadAll(teamName, agentName string) ([]InboxMessage, error) {
	if i.readAllErr != nil {
		return nil, i.readAllErr
	}
	return i.InMemoryInbox.ReadAll(teamName, agentName)
}

func (i *testTeamInboxStore) Unread(teamName, agentName string) ([]InboxMessage, error) {
	if i.unreadErr != nil {
		return nil, i.unreadErr
	}
	return i.InMemoryInbox.Unread(teamName, agentName)
}

func (i *testTeamInboxStore) MarkRead(teamName, agentName string) ([]InboxMessage, error) {
	if i.markErr != nil {
		return nil, i.markErr
	}
	return i.InMemoryInbox.MarkRead(teamName, agentName)
}

func (i *testTeamInboxStore) Remove(teamName, agentName string) error {
	if i.removeErr != nil {
		return i.removeErr
	}
	return i.InMemoryInbox.Remove(teamName, agentName)
}

type spawnBudgetStub struct {
	err error
}

func (b spawnBudgetStub) CheckSpawnAvailable() error {
	return b.err
}
