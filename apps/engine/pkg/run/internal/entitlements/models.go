package entitlements

import (
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/payments"
)

func ValidateModels(plan, modelID string, roleModels map[string]string) error {
	if !payments.CanUseModel(plan, modelID) {
		return fmt.Errorf("model %q requires a Pro or Super subscription", strings.TrimSpace(modelID))
	}
	for role, roleModelID := range roleModels {
		if !payments.CanUseModel(plan, roleModelID) {
			return fmt.Errorf("model %q for role %q requires a Pro or Super subscription", strings.TrimSpace(roleModelID), role)
		}
	}
	return nil
}
