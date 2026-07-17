package developer

import (
	"context"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/convert"
	devsvc "github.com/TaskForceAI/developer-service/pkg/developer"
	devhandler "github.com/TaskForceAI/developer-service/pkg/handler"
)

type querySource = devsvc.DeveloperQuerySource

type developerAccountStore interface {
	GetDeveloperAccount(ctx context.Context, userID int) (*developerAccount, error)
}

type sqlcDeveloperAccountStore struct {
	store account.IDStore
}

type developerAccount struct {
	APITier               *devsvc.DeveloperApiTier
	APIRequestsUsed       *int
	APIRequestsLimit      *int
	APICurrentPeriodStart *time.Time
	APICurrentPeriodEnd   *time.Time
}

func getDBQueries(ctx context.Context, q querySource) (querySource, error) {
	if q != nil {
		return q, nil
	}
	return devhandler.GetQueries(ctx)
}

func developerAccountStoreFromQueries(q querySource) developerAccountStore {
	return sqlcDeveloperAccountStore{store: account.NewIDStore(q)}
}

func isUserIDRangeError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "exceeds int32 range")
}

func (s sqlcDeveloperAccountStore) GetDeveloperAccount(ctx context.Context, userID int) (*developerAccount, error) {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return nil, err
	}
	user, err := s.store.GetByID(ctx, dbUserID)
	if err != nil {
		return nil, err
	}

	account := &developerAccount{}
	if user.APITier != "" {
		tier := devsvc.DeveloperApiTier(user.APITier)
		account.APITier = &tier
	}

	requestsUsed := int(user.APIRequestsUsed)
	account.APIRequestsUsed = &requestsUsed

	requestsLimit := int(user.APIRequestsLimit)
	account.APIRequestsLimit = &requestsLimit

	account.APICurrentPeriodStart = user.APICurrentPeriodStart
	account.APICurrentPeriodEnd = user.APICurrentPeriodEnd

	return account, nil
}
