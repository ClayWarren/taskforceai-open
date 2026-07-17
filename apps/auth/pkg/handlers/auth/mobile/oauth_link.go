package mobile

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
)

var (
	errOAuthEmailRequired    = errors.New("oauth email is required for first-time login")
	errOAuthProviderRequired = errors.New("oauth provider is required")
	errOAuthSubjectRequired  = errors.New("oauth subject is required")
)

type oauthLinkInput struct {
	Provider          string
	ProviderAccountID string
	Email             string
	FullName          string
}

func linkOrCreateOAuthUser(ctx context.Context, q *db.Queries, input oauthLinkInput) (*auth.AuthUser, error) {
	if q == nil {
		return nil, errors.New("queries are required")
	}

	provider := strings.TrimSpace(input.Provider)
	providerAccountID := strings.TrimSpace(input.ProviderAccountID)
	email := strings.TrimSpace(input.Email)
	fullName := strings.TrimSpace(input.FullName)

	if provider == "" {
		return nil, errOAuthProviderRequired
	}
	if providerAccountID == "" {
		return nil, errOAuthSubjectRequired
	}

	var p postgres.Transactor
	if transactor, ok := q.GetDB().(postgres.Transactor); ok {
		p = transactor
	} else {
		var err error
		p, err = postgres.GetPool(ctx)
		if err != nil {
			return nil, err
		}
	}

	var finalUser *auth.AuthUser

	txErr := postgres.WithTx(ctx, p, func(tx pgx.Tx) error {
		txQ := q.WithTx(tx)
		accountRepo := auth.NewAccountRepository(txQ)
		existingUser, err := accountRepo.GetUserByAccount(ctx, provider, providerAccountID)
		if errors.Is(err, auth.ErrUserNotFound) {
			existingUser = nil
			err = nil
		}
		if err != nil {
			return err
		}
		if existingUser != nil {
			if existingUser.Disabled {
				return auth.ErrUserDisabled
			}
			finalUser = existingUser
			return nil
		}

		if email == "" {
			return errOAuthEmailRequired
		}

		userRepo := auth.NewAuthUserRepository(txQ)
		user, err := userRepo.FindByEmail(ctx, email)
		if errors.Is(err, auth.ErrUserNotFound) {
			user = nil
			err = nil
		}
		if err != nil {
			return err
		}

		if user == nil {
			regRepo := auth.NewRegisterRepository(txQ)
			registerInput := auth.RegisterUserInput{Email: email}
			if fullName != "" {
				registerInput.FullName = &fullName
			}

			createdUser, createErr := regRepo.CreateUser(ctx, registerInput)
			if createErr != nil {
				return createErr
			}

			user = &auth.AuthUser{
				ID:       createdUser.ID,
				Email:    createdUser.Email,
				FullName: createdUser.FullName,
				Disabled: createdUser.Disabled,
			}
		}

		if user.Disabled {
			return auth.ErrUserDisabled
		}

		_, err = accountRepo.CreateAccount(ctx, auth.CreateAccountInput{
			UserID:            user.ID,
			Type:              "oauth",
			Provider:          provider,
			ProviderAccountID: providerAccountID,
		})
		if err != nil {
			return err
		}

		finalUser = user
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return finalUser, nil
}
