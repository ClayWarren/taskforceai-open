package developer

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type MockDeveloperRepository struct {
	mock.Mock
}

func (m *MockDeveloperRepository) ListKeysForUser(ctx context.Context, userID int) ([]DeveloperApiKeyRecord, error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).([]DeveloperApiKeyRecord)
	return val, args.Error(1)
}

func (m *MockDeveloperRepository) CountActiveKeysForUser(ctx context.Context, userID int) (int, error) {
	args := m.Called(ctx, userID)
	return args.Int(0), args.Error(1)
}

func (m *MockDeveloperRepository) FindKeyForUser(ctx context.Context, keyID, userID int) (*DeveloperApiKeyRecord, error) {
	args := m.Called(ctx, keyID, userID)
	val, _ := args.Get(0).(*DeveloperApiKeyRecord)
	return val, args.Error(1)
}

func (m *MockDeveloperRepository) RevokeKey(ctx context.Context, keyID int) error {
	args := m.Called(ctx, keyID)
	return args.Error(0)
}

func (m *MockDeveloperRepository) CreateApiKey(ctx context.Context, userID int, keyHash, displayKey string, tier DeveloperApiTier, rateLimit, monthlyQuota int) error {
	args := m.Called(ctx, userID, keyHash, displayKey, tier, rateLimit, monthlyQuota)
	return args.Error(0)
}

func (m *MockDeveloperRepository) GetUsageTotalsForKey(ctx context.Context, keyID int, startOfHour, startOfDay, startOfWeek, startOfMonth time.Time) (UsageTotals, error) {
	args := m.Called(ctx, keyID, startOfHour, startOfDay, startOfWeek, startOfMonth)
	val, _ := args.Get(0).(UsageTotals)
	return val, args.Error(1)
}

func (m *MockDeveloperRepository) ListUsageHistory(ctx context.Context, keyIDs []int, since time.Time) ([]UsageHistoryRecord, error) {
	args := m.Called(ctx, keyIDs, since)
	val, _ := args.Get(0).([]UsageHistoryRecord)
	return val, args.Error(1)
}

func TestKeysService_CreateKey(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(5, nil).Once()
	mockRepo.On("CreateApiKey", mock.Anything, 1, mock.AnythingOfType("string"), mock.AnythingOfType("string"), TierStarter, 1000, 1000000).Return(nil).Once()

	tier := TierStarter
	output, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, Tier: &tier})
	require.NoError(t, err)
	assert.Equal(t, TierStarter, output.Tier)
	assert.Contains(t, output.Key, "tfai_")

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(10, nil).Once()
	_, err = s.CreateKey(ctx, CreateKeyInput{UserID: 1, Tier: &tier})
	require.ErrorIs(t, err, ErrKeyLimitReached)
}

func TestKeysService_CreateKey_CountError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, errors.New("db error")).Once()

	_, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1})
	assert.Error(t, err)
}

func TestKeysService_CreateKey_RandomReadError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	originalReadRandom := readRandom
	readRandom = func([]byte) (int, error) {
		return 0, errors.New("entropy unavailable")
	}
	t.Cleanup(func() { readRandom = originalReadRandom })

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()

	_, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "entropy unavailable")
	mockRepo.AssertNotCalled(t, "CreateApiKey", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestKeysService_CreateKey_DeniesTierUpgrade(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()

	requestedTier := TierEnterprise
	userTier := TierStarter
	_, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, Tier: &requestedTier, UserTier: &userTier})
	require.ErrorIs(t, err, ErrTierUpgradeDenied)
	mockRepo.AssertNotCalled(t, "CreateApiKey", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestKeysService_CreateKey_EnterpriseTier(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	tier := TierEnterprise
	userTier := TierEnterprise
	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()
	mockRepo.On("CreateApiKey", mock.Anything, 1, mock.AnythingOfType("string"), mock.AnythingOfType("string"), TierEnterprise, 10000, 100000000).Return(nil).Once()

	output, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, Tier: &tier, UserTier: &userTier})
	require.NoError(t, err)
	assert.Equal(t, TierEnterprise, output.Tier)
}

func TestKeysService_CreateKey_InvalidTier(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()

	userTier := TierStarter
	badTier := DeveloperApiTier("BAD")
	_, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, UserTier: &userTier, Tier: &badTier})
	assert.ErrorIs(t, err, ErrInvalidTier)
}

func TestKeysService_CreateKey_InvalidUserTier(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()

	badTier := DeveloperApiTier("BAD")
	_, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, UserTier: &badTier})
	assert.ErrorIs(t, err, ErrInvalidTier)
}

func TestKeysService_CreateKey_ProTier(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	tier := TierPro
	userTier := TierPro
	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()
	mockRepo.On("CreateApiKey", mock.Anything, 1, mock.AnythingOfType("string"), mock.AnythingOfType("string"), TierPro, 5000, 10000000).Return(nil).Once()

	output, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, Tier: &tier, UserTier: &userTier})
	require.NoError(t, err)
	assert.Equal(t, TierPro, output.Tier)
}

func TestKeysService_CreateKey_NormalizesRequestedTier(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	tier := DeveloperApiTier(" pro ")
	userTier := TierPro
	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()
	mockRepo.On("CreateApiKey", mock.Anything, 1, mock.AnythingOfType("string"), mock.AnythingOfType("string"), TierPro, 5000, 10000000).Return(nil).Once()

	output, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1, Tier: &tier, UserTier: &userTier})
	require.NoError(t, err)
	assert.Equal(t, TierPro, output.Tier)
}

func TestKeysService_CreateKey_RepositoryError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()
	mockRepo.On("CreateApiKey", mock.Anything, 1, mock.AnythingOfType("string"), mock.AnythingOfType("string"), TierStarter, mock.Anything, mock.Anything).Return(errors.New("db error")).Once()

	_, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1})
	assert.Error(t, err)
}

func TestKeysService_CreateKey_TierDefault(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("CountActiveKeysForUser", mock.Anything, 1).Return(0, nil).Once()
	mockRepo.On("CreateApiKey", mock.Anything, 1, mock.AnythingOfType("string"), mock.AnythingOfType("string"), TierStarter, 1000, 1000000).Return(nil).Once()

	output, err := s.CreateKey(ctx, CreateKeyInput{UserID: 1})
	require.NoError(t, err)
	assert.Equal(t, TierStarter, output.Tier)
}

func TestKeysService_ListKeys(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	keys := []DeveloperApiKeyRecord{
		{ID: 1, DisplayKey: "key1", Tier: TierStarter},
		{ID: 2, DisplayKey: "key2", Tier: TierPro},
	}
	mockRepo.On("ListKeysForUser", ctx, 1).Return(keys, nil).Once()

	result, err := s.ListKeys(ctx, 1)
	require.NoError(t, err)
	assert.Len(t, result, 2)
}

func TestKeysService_ListKeys_Error(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("ListKeysForUser", ctx, 1).Return(nil, errors.New("db error")).Once()

	_, err := s.ListKeys(ctx, 1)
	assert.Error(t, err)
}

func TestKeysService_RevokeKey(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperKeysService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindKeyForUser", mock.Anything, 10, 1).Return(&DeveloperApiKeyRecord{
		ID:         10,
		DisplayKey: "tfai_...1234",
		RevokedAt:  nil,
	}, nil).Once()
	mockRepo.On("RevokeKey", mock.Anything, 10).Return(nil).Once()

	out, err := s.RevokeKey(ctx, 1, 10)
	require.NoError(t, err)
	assert.Equal(t, "tfai_...1234", out.DisplayKey)

	now := time.Now()
	mockRepo.On("FindKeyForUser", mock.Anything, 11, 1).Return(&DeveloperApiKeyRecord{
		ID:         11,
		DisplayKey: "tfai_...5678",
		RevokedAt:  &now,
	}, nil).Once()

	_, err = s.RevokeKey(ctx, 1, 11)
	require.ErrorIs(t, err, ErrKeyAlreadyRevoked)
}
