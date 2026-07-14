package orchestrator

import (
	"context"
	"fmt"
	"time"

	"github.com/TaskForceAI/core/pkg/team"
)

// Model Provider Implementation
type TeamModelProvider struct {
	orch *TaskOrchestrator
}

func (p *TeamModelProvider) ParseModel(model string) (team.ModelInfo, error) {
	// Simple parsing for now: provider/model
	return team.ModelInfo{ProviderID: "default", ModelID: model}, nil
}

func (p *TeamModelProvider) GetModel(ctx context.Context, providerID, modelID string) (any, error) {
	return nil, nil //nolint:nilnil // This compatibility provider validates by error only and has no model payload.
}

func (p *TeamModelProvider) DefaultModel(ctx context.Context) (team.ModelInfo, error) {
	if p.orch == nil {
		return team.ModelInfo{ProviderID: "default", ModelID: "openai/gpt-5.6-sol"}, nil
	}
	return team.ModelInfo{ProviderID: "default", ModelID: p.orch.config.Gateway.Model}, nil
}

// Session Manager Implementation (The most complex part)
type TeamSessionManager struct {
	orch *TaskOrchestrator
}

func (m *TeamSessionManager) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	// In the unified orchestrator, this might wake up an agent or append to a log
	return nil
}

func (m *TeamSessionManager) AutoWake(ctx context.Context, sessionID string) error {
	return nil
}

func (m *TeamSessionManager) GetSessionInfo(ctx context.Context, sessionID string) (string, string, string, error) {
	if m.orch == nil {
		return "agent", "default", "openai/gpt-5.6-sol", nil
	}
	return "agent", "default", m.orch.config.Gateway.Model, nil
}

func (m *TeamSessionManager) UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error {
	return nil
}

func (m *TeamSessionManager) RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error {
	return nil
}

func (m *TeamSessionManager) CancelPrompt(ctx context.Context, sessionID string) error {
	if m.orch == nil {
		return fmt.Errorf("orchestrator not configured")
	}

	if !m.orch.CancelSessionPrompt(sessionID) {
		return nil
	}

	return nil
}

func (m *TeamSessionManager) RemoveSession(ctx context.Context, sessionID string) error {
	return nil
}

func (m *TeamSessionManager) CreateSession(ctx context.Context, parentID, agentName, title string, permissions []team.PermissionRule) (string, error) {
	// We return a synthetic session ID for now
	return fmt.Sprintf("ses_%s_%d", agentName, time.Now().UnixNano()), nil
}

func (m *TeamSessionManager) StartPromptLoop(ctx context.Context, sessionID string) error {
	return nil
}

func (m *TeamSessionManager) GetLastUserMessageModel(ctx context.Context, sessionID string) (*team.ModelInfo, error) {
	if m.orch == nil {
		return &team.ModelInfo{ProviderID: "default", ModelID: "openai/gpt-5.6-sol"}, nil
	}
	return &team.ModelInfo{ProviderID: "default", ModelID: m.orch.config.Gateway.Model}, nil
}
