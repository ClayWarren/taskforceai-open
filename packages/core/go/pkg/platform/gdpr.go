package platform

import (
	"context"
	"strconv"
)

type GdprStore interface {
	GetUserByEmail(ctx context.Context, email string) (GdprUser, error)
	GetConversationsByUser(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error)
	ExportUserData(ctx context.Context, userID int32) (GdprExport, error)
	DeleteUser(ctx context.Context, userID int32) error
}

type GdprExport map[string]any

type GdprUser struct {
	ID       int32   `json:"id"`
	Email    string  `json:"email"`
	FullName *string `json:"fullName,omitempty"`
}

type GdprConversation struct {
	ID        int32  `json:"id"`
	UserInput string `json:"userInput,omitempty"`
}

type GetConversationsByUserInput struct {
	UserID string
	Limit  int32
	Offset int32
}

type GdprService struct {
	store GdprStore
}

func NewGdprService(store GdprStore) *GdprService {
	return &GdprService{store: store}
}

func (s *GdprService) FindExportUserByEmail(ctx context.Context, email string) (GdprUser, error) {
	return s.store.GetUserByEmail(ctx, email)
}

func (s *GdprService) ExportUserDataByEmail(ctx context.Context, email string) (GdprExport, error) {
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	return s.store.ExportUserData(ctx, user.ID)
}

func (s *GdprService) FindConversationsByEmail(ctx context.Context, email string) ([]GdprConversation, error) {
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}

	userID := strconv.FormatInt(int64(user.ID), 10)

	const pageSize int32 = 1000
	conversations := make([]GdprConversation, 0)
	for offset := int32(0); ; offset += pageSize {
		page, pageErr := s.store.GetConversationsByUser(ctx, GetConversationsByUserInput{
			UserID: userID,
			Limit:  pageSize,
			Offset: offset,
		})
		if pageErr != nil {
			return nil, pageErr
		}
		conversations = append(conversations, page...)
		if len(page) < int(pageSize) {
			return conversations, nil
		}
	}
}

func (s *GdprService) FindDeleteUserByEmail(ctx context.Context, email string) (GdprUser, error) {
	return s.store.GetUserByEmail(ctx, email)
}

func (s *GdprService) DeleteUserData(ctx context.Context, userID int32) error {
	return s.store.DeleteUser(ctx, userID)
}
