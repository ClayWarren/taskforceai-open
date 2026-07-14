package auth

import (
	"testing"

	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/stretchr/testify/assert"
)

func TestGetTokenRevoker_NilWhenRedisUnavailable(t *testing.T) {
	authhandler.SetRedisClient(nil)
	revoker := getTokenRevoker()
	assert.Nil(t, revoker)
}
