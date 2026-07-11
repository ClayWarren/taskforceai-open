package run

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSendApprovalDecision_GetClientError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return mockRedis, nil
	})

	original := getApprovalClient
	getApprovalClient = func() (approvalClient, error) {
		return nil, errors.New("redis unavailable")
	}
	t.Cleanup(func() {
		getApprovalClient = original
	})

	err := SendApprovalDecision(context.Background(), "task-send-decision-client-error", ApprovalDecision{Approved: true})
	require.NoError(t, err)

	raw, getErr := mockRedis.Get(context.Background(), approvalDecisionKey("task-send-decision-client-error"))
	require.NoError(t, getErr)
	var decision ApprovalDecision
	require.NoError(t, json.Unmarshal([]byte(raw), &decision))
	assert.True(t, decision.Approved)
}

func TestSendApprovalDecision_PayloadTooLarge(t *testing.T) {
	mockRedis := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return mockRedis, nil
	})

	client := &stubApprovalClient{}
	setApprovalClientFactoryForTest(t, client)

	oversizedValue := strings.Repeat("x", MaxApprovalDecisionPayloadBytes)
	err := SendApprovalDecision(context.Background(), "task-send-decision-payload-too-large", ApprovalDecision{
		Approved: true,
		Result:   map[string]any{"value": oversizedValue},
	})
	require.Error(t, err)
	require.ErrorIs(t, err, ErrApprovalDecisionPayloadTooLarge)

	assert.Empty(t, client.publishedTo)
	assert.Nil(t, client.publishedBytes)

	_, getErr := mockRedis.Get(context.Background(), approvalDecisionKey("task-send-decision-payload-too-large"))
	assert.Error(t, getErr)
}

func TestSendApprovalDecision_PersistAndClientBothFail(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	})
	original := getApprovalClient
	getApprovalClient = func() (approvalClient, error) {
		return nil, errors.New("pubsub down")
	}
	t.Cleanup(func() { getApprovalClient = original })

	err := SendApprovalDecision(context.Background(), "task-both-fail", ApprovalDecision{Approved: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "persist approval decision")
}

func TestSendApprovalDecision_PersistFailsAfterPublish(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &approvalSetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	setApprovalClientFactoryForTest(t, &stubApprovalClient{})

	err := SendApprovalDecision(context.Background(), "task-persist-after-publish", ApprovalDecision{Approved: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "persist approval decision")
}

func TestSendApprovalDecision_PersistAndPublishBothFail(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &approvalSetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	setApprovalClientFactoryForTest(t, &stubApprovalClient{publishErr: errors.New("publish failed")})

	err := SendApprovalDecision(context.Background(), "task-persist-publish-fail", ApprovalDecision{Approved: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "persist approval decision")
}

func TestSendApprovalDecision_PersistFailsAfterSuccessfulPublish(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &approvalSetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	client := &stubApprovalClient{}
	setApprovalClientFactoryForTest(t, client)

	err := SendApprovalDecision(context.Background(), "task-persist-fail", ApprovalDecision{Approved: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "persist approval decision")
	assert.NotEmpty(t, client.publishedTo)
}

func TestSendApprovalDecision_PublishError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return mockRedis, nil
	})

	client := &stubApprovalClient{publishErr: errors.New("publish failed")}
	setApprovalClientFactoryForTest(t, client)

	err := SendApprovalDecision(context.Background(), "task-send-decision-error", ApprovalDecision{Approved: false})
	require.NoError(t, err)

	raw, getErr := mockRedis.Get(context.Background(), approvalDecisionKey("task-send-decision-error"))
	require.NoError(t, getErr)
	var decision ApprovalDecision
	require.NoError(t, json.Unmarshal([]byte(raw), &decision))
	assert.False(t, decision.Approved)
}

func TestSendApprovalDecision_PublishFailsPersistSucceeds(t *testing.T) {
	mockRedis := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })
	client := &stubApprovalClient{publishErr: errors.New("publish failed")}
	setApprovalClientFactoryForTest(t, client)

	err := SendApprovalDecision(context.Background(), "task-publish-fail", ApprovalDecision{Approved: true})
	require.NoError(t, err)
}

func TestSendApprovalDecision_PublishesDecision(t *testing.T) {
	client := &stubApprovalClient{}
	setApprovalClientFactoryForTest(t, client)

	err := SendApprovalDecision(context.Background(), "task-send-decision", ApprovalDecision{Approved: true})
	require.NoError(t, err)

	assert.Equal(t, "task:approval:task-send-decision", client.publishedTo)

	var payload ApprovalDecision
	require.NoError(t, json.Unmarshal(client.publishedBytes, &payload))
	assert.True(t, payload.Approved)
}
