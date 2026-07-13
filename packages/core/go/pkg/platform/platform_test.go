package platform

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type gdprSuccessStore struct{}

func (gdprSuccessStore) GetUserByEmail(_ context.Context, email string) (GdprUser, error) {
	return GdprUser{ID: 7, Email: email}, nil
}

func (gdprSuccessStore) GetConversationsByUser(_ context.Context, input GetConversationsByUserInput) ([]GdprConversation, error) {
	if input.UserID != "7" {
		return nil, assert.AnError
	}
	return []GdprConversation{{ID: 1, UserInput: "hello"}}, nil
}

func (gdprSuccessStore) DeleteUser(context.Context, int32) error { return nil }

func TestArtifactMatchesVersionGapCoverage(t *testing.T) {
	path := "desktop/macos/TaskForceAI-1.0.0-x64.dmg"
	assert.False(t, artifactMatchesVersion(path, "", "-x64.dmg"))
	assert.True(t, artifactMatchesVersion(path, "1.0.0", "-x64.dmg"))
	assert.False(t, artifactMatchesVersion(path, "11.0.0", "-x64.dmg"))
	assert.False(t, artifactMatchesVersion(path, "macos", "-x64.dmg"))
	assert.False(t, artifactMatchesVersion(path, "x64", "-x64.dmg"))
	assert.False(t, artifactMatchesVersion(path, "1.0.0", ".pkg"))
}

func TestPlatformMiscFinalPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("status service builds service status payload", func(t *testing.T) {
		svc := NewStatusService()
		status, err := svc.GetServiceStatus(context.Background())
		require.NoError(t, err)
		assert.Equal(t, ServiceStatusOperational, status.OverallStatus)
		assert.Len(t, status.Services, len(ServiceOrder))
		for _, service := range status.Services {
			assert.NotEmpty(t, service.ID)
			assert.NotEmpty(t, service.Name)
			assert.Len(t, service.UptimeHistory, 90)
		}
	})

	t.Run("publish reports publisher failure", func(t *testing.T) {
		expected := errors.New("publisher failed")
		svc := NewStatusService(&statusPublisherStub{err: expected})
		err := svc.Publish(context.Background())
		require.Error(t, err)
		assert.ErrorIs(t, err, expected)
	})

	t.Run("gdpr find conversations returns data for known user", func(t *testing.T) {
		svc := NewGdprService(gdprSuccessStore{})
		conversations, err := svc.FindConversationsByEmail(context.Background(), "user@example.com")
		require.NoError(t, err)
		require.Len(t, conversations, 1)
		assert.Equal(t, int32(1), conversations[0].ID)
	})
}

func TestPublishGapCoverage(t *testing.T) {
	svc := NewStatusService()
	ctx := context.Background()

	t.Run("missing publisher", func(t *testing.T) {
		err := svc.Publish(ctx)
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrStatusPublisherUnavailable)
	})
}

func TestResolveDownloadPrefixParsing(t *testing.T) {
	// Exercise prefix/suffix parsing without calling remote blob APIs.
	m := DownloadMapping["desktop"]["macos"]
	prefix := m.Pattern
	suffix := ""
	if starIdx := len(prefix); starIdx >= 0 {
		if idx := indexStar(prefix); idx != -1 {
			suffix = prefix[idx+1:]
			prefix = prefix[:idx]
		}
	}
	assert.Equal(t, "desktop/macos/TaskForceAI-", prefix)
	assert.Equal(t, "-x64.dmg", suffix)
}

func indexStar(value string) int {
	for i := 0; i < len(value); i++ {
		if value[i] == '*' {
			return i
		}
	}
	return -1
}
