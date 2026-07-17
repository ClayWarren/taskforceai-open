package run

import (
	"github.com/TaskForceAI/go-engine/pkg/run/internal/entitlements"
	"github.com/TaskForceAI/go-engine/pkg/run/internal/redisutil"
)

func isRedisKeyNotFoundError(err error) bool {
	return redisutil.IsKeyNotFoundError(err)
}

func validateModelEntitlements(plan, modelID string, roleModels map[string]string) error {
	return entitlements.ValidateModels(plan, modelID, roleModels)
}
