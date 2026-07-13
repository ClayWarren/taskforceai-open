package sync

import (
	"errors"
)

// Validatable defines an interface for structs that can validate themselves.
type Validatable interface {
	Validate() error
}

func (e BroadcastEvent) Validate() error {
	if e.Type == "" {
		return errors.New("type is required")
	}
	return nil
}

func (c ConversationSyncPayload) Validate() error {
	if c.Timestamp == "" {
		return errors.New("timestamp is required")
	}
	if !c.IsDeleted && c.UserInput == "" {
		return errors.New("userInput is required")
	}
	if c.UpdatedAt == "" {
		return errors.New("updatedAt is required")
	}
	return nil
}

func (m MessageSyncPayload) Validate() error {
	if m.MessageID == "" {
		return errors.New("messageId is required")
	}
	if m.Role == "" {
		return errors.New("role is required")
	}
	if !m.IsDeleted && m.Content == "" {
		return errors.New("content is required")
	}
	if m.CreatedAt == "" {
		return errors.New("createdAt is required")
	}
	if m.UpdatedAt == "" {
		return errors.New("updatedAt is required")
	}
	return nil
}

func (d DeletionRecord) Validate() error {
	if d.Type != "conversation" && d.Type != "message" {
		return errors.New("invalid deletion type")
	}
	if d.ID == "" {
		return errors.New("id is required")
	}
	if d.DeletedAt == "" {
		return errors.New("deletedAt is required")
	}
	return nil
}

func (r SyncPullResponse) Validate() error {
	for _, c := range r.Conversations {
		if err := c.Validate(); err != nil {
			return err
		}
	}
	for _, m := range r.Messages {
		if err := m.Validate(); err != nil {
			return err
		}
	}
	for _, d := range r.Deletions {
		if err := d.Validate(); err != nil {
			return err
		}
	}
	return nil
}
