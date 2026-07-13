package platform

import (
	"context"
	"strconv"
)

type GdprStore interface {
	GetUserByEmail(ctx context.Context, email string) (GdprUser, error)
	GetConversationsByUser(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error)
	DeleteUser(ctx context.Context, userID int32) error
}

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

func (s *GdprService) FindConversationsByEmail(ctx context.Context, email string) ([]GdprConversation, error) {
	user, err := s.store.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}

	userID := strconv.FormatInt(int64(user.ID), 10)

	return s.store.GetConversationsByUser(ctx, GetConversationsByUserInput{
		UserID: userID,
		Limit:  1000,
		Offset: 0,
	})
}

func (s *GdprService) FindDeleteUserByEmail(ctx context.Context, email string) (GdprUser, error) {
	return s.store.GetUserByEmail(ctx, email)
}

func (s *GdprService) DeleteUserData(ctx context.Context, userID int32) error {
	return s.store.DeleteUser(ctx, userID)
}
