package team

import (
	"fmt"
	"sync"
)

type InMemoryInbox struct {
	mu       sync.RWMutex
	messages map[string][]InboxMessage
}

func NewInMemoryInbox() *InMemoryInbox {
	return &InMemoryInbox{
		messages: map[string][]InboxMessage{},
	}
}

func teamInboxKey(teamName, agentName string) (string, error) {
	if err := ValidateInboxName(teamName, "team"); err != nil {
		return "", err
	}
	if err := ValidateInboxName(agentName, "agent"); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s", teamName, agentName), nil
}

func (i *InMemoryInbox) Write(teamName, to string, msg InboxMessage) error {
	key, err := teamInboxKey(teamName, to)
	if err != nil {
		return err
	}

	i.mu.Lock()
	defer i.mu.Unlock()

	if i.messages == nil {
		i.messages = map[string][]InboxMessage{}
	}
	if len(i.messages[key]) >= MaxInboxMessages {
		return fmt.Errorf("inbox for %q in team %q has reached the maximum of %d messages", to, teamName, MaxInboxMessages)
	}

	msg.Read = false
	i.messages[key] = append(i.messages[key], msg)
	return nil
}

func (i *InMemoryInbox) ReadAll(teamName, agentName string) ([]InboxMessage, error) {
	key, err := teamInboxKey(teamName, agentName)
	if err != nil {
		return nil, err
	}

	i.mu.RLock()
	defer i.mu.RUnlock()

	return append([]InboxMessage(nil), i.messages[key]...), nil
}

func (i *InMemoryInbox) Unread(teamName, agentName string) ([]InboxMessage, error) {
	messages, err := i.ReadAll(teamName, agentName)
	if err != nil {
		return nil, err
	}

	unread := make([]InboxMessage, 0, len(messages))
	for _, msg := range messages {
		if !msg.Read {
			unread = append(unread, msg)
		}
	}
	return unread, nil
}

func (i *InMemoryInbox) MarkRead(teamName, agentName string) ([]InboxMessage, error) {
	key, err := teamInboxKey(teamName, agentName)
	if err != nil {
		return nil, err
	}

	i.mu.Lock()
	defer i.mu.Unlock()

	messages := i.messages[key]
	read := make([]InboxMessage, 0, len(messages))
	for index := range messages {
		if messages[index].Read {
			continue
		}
		messages[index].Read = true
		read = append(read, messages[index])
	}
	i.messages[key] = messages
	return read, nil
}

func (i *InMemoryInbox) Remove(teamName, agentName string) error {
	key, err := teamInboxKey(teamName, agentName)
	if err != nil {
		return err
	}

	i.mu.Lock()
	defer i.mu.Unlock()

	delete(i.messages, key)
	return nil
}
