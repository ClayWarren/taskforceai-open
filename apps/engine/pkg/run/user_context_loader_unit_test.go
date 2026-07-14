package run

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/memories"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubUserContextStore struct {
	user                 userContextUserRow
	projectInstructions  *string
	projectErr           error
	getUserSettingsCalls int
}

func (s *stubUserContextStore) GetUserSettings(ctx context.Context, userID int32) (userContextUserRow, error) {
	s.getUserSettingsCalls++
	return s.user, nil
}

func (s *stubUserContextStore) ListUserMemories(ctx context.Context, userID int32) ([]userContextMemoryRow, error) {
	return nil, nil
}

func (s *stubUserContextStore) ListUserMemoriesWithOrg(ctx context.Context, input memories.GetUserMemoriesWithOrgInput) ([]userContextMemoryRow, error) {
	return nil, nil
}

func (s *stubUserContextStore) ListUserAccounts(ctx context.Context, userID int32) ([]userContextAccountRow, error) {
	return nil, nil
}

func (s *stubUserContextStore) GetProjectInstructions(ctx context.Context, input projectInstructionsLookupInput) (projectInstructionsRow, error) {
	if s.projectErr != nil {
		return projectInstructionsRow{}, s.projectErr
	}
	return projectInstructionsRow{CustomInstructions: s.projectInstructions}, nil
}

func TestLoadCachedUserSettingsCacheReadBranches(t *testing.T) {
	ctx := context.Background()
	store := &stubUserContextStore{
		user: userContextUserRow{
			ID:                   42,
			Plan:                 "pro",
			MemoryEnabled:        true,
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
		},
	}

	mockRedis := withMockRedis(t)
	require.NoError(t, mockRedis.Set(ctx, "user_settings:42", []byte("{"), time.Minute))
	got, err := loadCachedUserSettings(ctx, store, 42)
	require.NoError(t, err)
	assert.Equal(t, int32(42), got.ID)
	assert.Equal(t, 1, store.getUserSettingsCalls)

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &redisGetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	got, err = loadCachedUserSettings(ctx, store, 42)
	require.NoError(t, err)
	assert.Equal(t, int32(42), got.ID)
	assert.Equal(t, 2, store.getUserSettingsCalls)
}

func TestCacheUserSettingsSetFailureDoesNotPanic(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &approvalSetFailClient{MockClient: redis.NewMockClient()}, nil
	})

	cacheUserSettings(context.Background(), "user_settings:7", userContextUserRow{ID: 7})
}

func TestCacheUserSettingsEncodeFailureDoesNotWrite(t *testing.T) {
	restore(t, &marshalUserSettings)
	marshalUserSettings = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
	client := withMockRedis(t)

	cacheUserSettings(context.Background(), "user:encode-fail", userContextUserRow{ID: 7})
	_, err := client.Get(context.Background(), "user:encode-fail")
	require.Error(t, err)
}

func TestGithubTokenFromAccountNilToken(t *testing.T) {
	assert.Empty(t, githubTokenFromAccount(userContextAccountRow{}))
}

func TestLoadProjectInstructionsCacheReadAndWriteErrors(t *testing.T) {
	ctx := context.Background()
	projectID := int32(12)
	instructions := "project rules"
	input := UserContextLoadInput{UserID: 7, ProjectID: &projectID}
	store := &stubUserContextStore{projectInstructions: &instructions}

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &redisGetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	got, err := loadProjectInstructions(ctx, store, input)
	require.NoError(t, err)
	assert.Equal(t, instructions, got)

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &approvalSetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	got, err = loadProjectInstructions(ctx, store, input)
	require.NoError(t, err)
	assert.Equal(t, instructions, got)

	store.projectErr = errors.New("not found")
	_, err = loadProjectInstructions(ctx, store, input)
	require.Error(t, err)
}
