package executionpolicy

import (
	"fmt"
	"regexp"
	"strings"
)

var quickModeIdentityPromptPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\bwhat\s+model\s+are\s+you\b`),
	regexp.MustCompile(`\bwho\s+are\s+you\b`),
	regexp.MustCompile(`\bwhat\s+are\s+you\b`),
	regexp.MustCompile(`\bwho\s+(?:created|made|built|developed)\s+you\b`),
	regexp.MustCompile(`\bwho\s+is\s+your\s+(?:creator|maker|developer)\b`),
	regexp.MustCompile(`\bare\s+you\s+(?:a\s+)?(?:glm|zai|z\.ai|zhipu)\b`),
	regexp.MustCompile(`\b(?:your|the)\s+(?:model|provider|creator|maker|developer|identity)\b.*\b(?:glm|zai|z\.ai|zhipu)\b`),
}

func ApplyComputerUseSessionMode(
	projectInstructions string,
	computerUseEnabled bool,
	useLoggedInServices bool,
) string {
	if !computerUseEnabled {
		return projectInstructions
	}

	modeLabel := "LOGGED OUT"
	modeInstruction := "Use a logged-out browsing context. Do not rely on existing authenticated website sessions."
	if useLoggedInServices {
		modeLabel = "LOGGED IN"
		modeInstruction = "Use available authenticated website sessions when helpful for the task."
	}

	modeSection := fmt.Sprintf(
		"[COMPUTER USE SESSION MODE]\nMode: %s\n%s",
		modeLabel,
		modeInstruction,
	)

	if strings.TrimSpace(projectInstructions) == "" {
		return modeSection
	}

	return projectInstructions + "\n\n" + modeSection
}

func EnforceQuickModeIdentity(prompt, modelID, result, identityReply string) string {
	if modelID != "zai/glm-5.2" {
		return result
	}

	promptLower := strings.ToLower(strings.TrimSpace(prompt))
	resultLower := strings.ToLower(result)

	identityPrompt := false
	for _, pattern := range quickModeIdentityPromptPatterns {
		if pattern.MatchString(promptLower) {
			identityPrompt = true
			break
		}
	}

	providerIdentityLeak := strings.Contains(resultLower, "i am glm") ||
		strings.Contains(resultLower, "i'm glm") ||
		strings.Contains(resultLower, "created by z.ai") ||
		strings.Contains(resultLower, "created by zai") ||
		strings.Contains(resultLower, "created by zhipu") ||
		strings.Contains(resultLower, "an ai assistant created by z.ai") ||
		strings.Contains(resultLower, "an ai assistant created by zhipu")

	if identityPrompt || providerIdentityLeak {
		return identityReply
	}

	return result
}
