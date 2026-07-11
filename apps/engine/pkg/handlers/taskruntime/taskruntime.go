package taskruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"

	ff "github.com/TaskForceAI/feature-flags/pkg"
	"github.com/TaskForceAI/go-engine/pkg/run"
)

// BuildOptionsParams captures the common inputs needed to create orchestrator options.
type BuildOptionsParams struct {
	Options          map[string]any
	UserID           string
	UserEmail        string
	UserPlan         *string
	IsAdmin          bool
	ProjectID        *int32
	OrgID            *int32
	NoTraining       bool
	QuickModeDefault bool
	Source           string
	IsEval           bool
	RoleModels       map[string]string
	Budget           *float64
	ReasoningEffort  string
}

func ResolveUserPlan(userPlan *string) string {
	if userPlan == nil {
		return "free"
	}
	return *userPlan
}

func ReadStringOption(options map[string]any, key string) string {
	if options == nil {
		return ""
	}
	value, ok := options[key].(string)
	if !ok {
		return ""
	}
	return value
}

func ReadIntOption(options map[string]any, key string) (int, bool) {
	if options == nil {
		return 0, false
	}
	rawValue, exists := options[key]
	if !exists {
		return 0, false
	}
	switch value := rawValue.(type) {
	case int:
		return value, true
	case int32:
		return int(value), true
	case int64:
		return int(value), true
	case float64:
		if math.Trunc(value) != value {
			return 0, false
		}
		return int(value), true
	case json.Number:
		parsed, err := strconv.Atoi(value.String())
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func ReadBoolOption(options map[string]any, key string) (bool, bool) {
	if options == nil {
		return false, false
	}
	rawValue, exists := options[key]
	if !exists {
		return false, false
	}
	value, ok := rawValue.(bool)
	if !ok {
		return false, false
	}
	return value, true
}

func DetectAttachmentMIME(data []byte) string {
	if len(data) == 0 {
		return "application/octet-stream"
	}

	detectLen := min(len(data), 512)

	mime := http.DetectContentType(data[:detectLen])
	if idx := strings.Index(mime, ";"); idx != -1 {
		mime = strings.TrimSpace(mime[:idx])
	}

	return mime
}

func ResolveAttachments(
	ctx context.Context,
	attachmentIDs []string,
	onReadError func(attachmentID string, err error),
) run.Attachments {
	attachments := run.Attachments{Files: make([]run.FileAttachment, 0, len(attachmentIDs))}

	for _, fileID := range attachmentIDs {
		data, err := run.GetAttachment(ctx, fileID)
		if err != nil {
			if onReadError != nil {
				onReadError(fileID, err)
			}
			continue
		}

		mimeType := DetectAttachmentMIME(data)
		name := "attachment"
		size := int64(len(data))

		info, foundInfo, infoErr := run.GetAttachmentInfo(ctx, fileID)
		if infoErr != nil && onReadError != nil {
			onReadError(fileID, infoErr)
		}
		if foundInfo {
			if strings.TrimSpace(info.MimeType) != "" {
				mimeType = info.MimeType
			}
			if strings.TrimSpace(info.Name) != "" {
				name = info.Name
			}
			if info.Size > 0 {
				size = info.Size
			}
		}

		attachments.Files = append(attachments.Files, run.FileAttachment{
			ID:       fileID,
			Data:     data,
			MimeType: mimeType,
			Name:     name,
			Size:     size,
		})
	}

	return attachments
}

func attachmentBelongsToUser(attachmentID string, userID int) bool {
	trimmed := strings.TrimSpace(attachmentID)
	if trimmed == "" {
		return false
	}
	expectedPrefix := fmt.Sprintf("u:%d:", userID)
	return strings.HasPrefix(trimmed, expectedPrefix)
}

func ResolveAttachmentsForUser(
	ctx context.Context,
	attachmentIDs []string,
	userID int,
	onReadError func(attachmentID string, err error),
) (run.Attachments, []string) {
	authorized := make([]string, 0, len(attachmentIDs))
	unauthorized := make([]string, 0)
	for _, attachmentID := range attachmentIDs {
		if attachmentBelongsToUser(attachmentID, userID) {
			authorized = append(authorized, attachmentID)
			continue
		}
		unauthorized = append(unauthorized, attachmentID)
	}

	attachments := ResolveAttachments(ctx, authorized, onReadError)
	return attachments, unauthorized
}

func ReadClientMCPTools(options map[string]any) []run.ClientMCPTool {
	if options == nil {
		return nil
	}

	rawClientTools, ok := options["clientTools"].(map[string]any)
	if !ok {
		return nil
	}
	rawMCPTools, ok := rawClientTools["mcp"].([]any)
	if !ok {
		return nil
	}

	tools := make([]run.ClientMCPTool, 0, len(rawMCPTools))
	for _, item := range rawMCPTools {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}

		tool := run.ClientMCPTool{
			ServerName:  ReadStringOption(record, "serverName"),
			ToolName:    ReadStringOption(record, "toolName"),
			Title:       ReadStringOption(record, "title"),
			Description: ReadStringOption(record, "description"),
		}
		if tool.IsZero() {
			continue
		}
		tools = append(tools, tool)
	}

	return tools
}

func ReadStringSliceOption(options map[string]any, key string) []string {
	if options == nil {
		return nil
	}
	rawValues, ok := options[key].([]any)
	if !ok {
		return nil
	}

	values := make([]string, 0, len(rawValues))
	for _, rawValue := range rawValues {
		value, ok := rawValue.(string)
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		values = append(values, trimmed)
	}
	return values
}

func ReadResearchWorkflow(options map[string]any) run.ResearchWorkflowOption {
	if options == nil {
		return run.ResearchWorkflowOption{}
	}
	rawWorkflow, ok := options["researchWorkflow"].(map[string]any)
	if !ok {
		return run.ResearchWorkflowOption{}
	}

	workflow := run.ResearchWorkflowOption{
		Workflow:          ReadStringOption(rawWorkflow, "workflow"),
		PreferredExports:  ReadStringSliceOption(rawWorkflow, "preferredExports"),
		SourcePolicy:      ReadStringOption(rawWorkflow, "sourcePolicy"),
		RequiredCitations: true,
	}
	if requiredCitations, ok := ReadBoolOption(rawWorkflow, "requiredCitations"); ok {
		workflow.RequiredCitations = requiredCitations
	}
	if workflow.IsZero() {
		return run.ResearchWorkflowOption{}
	}
	return workflow
}

func shouldEnforceRemoteFeatureFlags() bool {
	if strings.TrimSpace(os.Getenv("TASKFORCE_BYPASS_FEATURE_FLAGS")) == "1" {
		return false
	}

	if isLocalFeatureFlagEnvironment() {
		return false
	}

	return strings.TrimSpace(os.Getenv("STATSIG_SECRET_KEY")) != ""
}

func shouldDenyPrivilegedFeaturesWhenFlagsUnconfigured() bool {
	if strings.TrimSpace(os.Getenv("TASKFORCE_BYPASS_FEATURE_FLAGS")) == "1" {
		return false
	}
	if isLocalFeatureFlagEnvironment() {
		return false
	}
	return strings.TrimSpace(os.Getenv("STATSIG_SECRET_KEY")) == ""
}

func isLocalFeatureFlagEnvironment() bool {
	env := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		os.Getenv("GO_ENV"),
		os.Getenv("NODE_ENV"),
	)))
	return env == "development" || env == "test"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func BuildOrchestrateTaskOptions(params BuildOptionsParams) run.OrchestrateTaskOptions {
	computerUseEnabled, _ := ReadBoolOption(params.Options, "computerUseEnabled")
	computerUseTargetOption := ReadStringOption(params.Options, "computerUseTarget")
	useLoggedInServices, _ := ReadBoolOption(params.Options, "useLoggedInServices")
	autonomyEnabled, _ := ReadBoolOption(params.Options, "autonomyEnabled")
	quickModeOverride, hasQuickModeOverride := ReadBoolOption(params.Options, "quickModeEnabled")
	agentCount, _ := ReadIntOption(params.Options, "agentCount")

	// Apply Feature Flags
	key := os.Getenv("STATSIG_SECRET_KEY")
	if computerUseEnabled || autonomyEnabled {
		switch {
		case shouldEnforceRemoteFeatureFlags():
			client := ff.GetClient(key)
			user := ff.User{
				UserID: params.UserID,
				Email:  params.UserEmail,
				Tier:   ResolveUserPlan(params.UserPlan),
			}
			statsigUser := ff.NewStatsigUser(user)
			if computerUseEnabled && !client.IsEnabledStatsigUser(statsigUser, ff.ModeComputerUse) {
				// If flag is disabled, force override to false for safety
				computerUseEnabled = false
			}
			if autonomyEnabled && !client.IsEnabledStatsigUser(statsigUser, ff.ModeAutonomy) {
				// If flag is disabled, force override to false for safety
				autonomyEnabled = false
			}
		case shouldDenyPrivilegedFeaturesWhenFlagsUnconfigured():
			computerUseEnabled = false
			autonomyEnabled = false
		}
	}

	quickModeEnabled := params.QuickModeDefault
	if hasQuickModeOverride {
		quickModeEnabled = quickModeOverride
	}
	computerUseTarget := normalizeComputerUseTarget(computerUseTargetOption, computerUseEnabled)
	if shouldDenyLoggedInComputerUse(params.Source) {
		useLoggedInServices = false
	}

	return run.OrchestrateTaskOptions{
		UserPlan:            ResolveUserPlan(params.UserPlan),
		ProjectID:           params.ProjectID,
		OrgID:               params.OrgID,
		NoTraining:          params.NoTraining,
		QuickModeEnabled:    quickModeEnabled,
		ComputerUseEnabled:  computerUseEnabled,
		ComputerUseTarget:   computerUseTarget,
		UseLoggedInServices: useLoggedInServices,
		Source:              params.Source,
		IsEval:              params.IsEval,
		RoleModels:          params.RoleModels,
		AutonomyEnabled:     autonomyEnabled,
		Budget:              params.Budget,
		ReasoningEffort:     strings.ToLower(strings.TrimSpace(params.ReasoningEffort)),
		AgentCount:          agentCount,
		ClientMCPTools:      ReadClientMCPTools(params.Options),
		ResearchWorkflow:    ReadResearchWorkflow(params.Options),
	}
}

func shouldDenyLoggedInComputerUse(source string) bool {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "api", "developer":
		return true
	default:
		return false
	}
}

func normalizeComputerUseTarget(target string, computerUseEnabled bool) string {
	if !computerUseEnabled {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(target)) {
	case "local":
		return "local"
	default:
		return "virtual"
	}
}
