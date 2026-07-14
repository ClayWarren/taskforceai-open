package taskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	ff "github.com/TaskForceAI/feature-flags/pkg"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAttachmentBelongsToUserEdgeCases(t *testing.T) {
	assert.False(t, attachmentBelongsToUser("", 1))
	assert.False(t, attachmentBelongsToUser("u:2:file", 1))
	assert.True(t, attachmentBelongsToUser("u:1:file", 1))
}

func TestBuildOrchestrateTaskOptionsAppliesOverrides(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "")
	budget := 2.5
	opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"quickModeEnabled": true,
			"agentCount":       float64(3),
			"clientTools": map[string]any{
				"mcp": []any{map[string]any{"serverName": "s", "toolName": "t"}},
			},
			"researchWorkflow": map[string]any{
				"workflow":          "investment_dossier",
				"requiredCitations": true,
				"preferredExports":  []any{"docx", "pdf"},
				"sourcePolicy":      "public_and_attached",
			},
		},
		UserID:           "user-1",
		UserEmail:        "user@example.com",
		UserPlan:         nil,
		QuickModeDefault: false,
		Budget:           &budget,
		Source:           "test",
		IsEval:           true,
	})
	assert.Equal(t, "free", opts.UserPlan)
	assert.True(t, opts.QuickModeEnabled)
	assert.Equal(t, 3, opts.AgentCount)
	assert.Equal(t, budget, *opts.Budget)
	assert.True(t, opts.IsEval)
	require.Len(t, opts.ClientMCPTools, 1)
	assert.Equal(t, "investment_dossier", opts.ResearchWorkflow.Workflow)
	assert.True(t, opts.ResearchWorkflow.RequiredCitations)
	assert.Equal(t, []string{"docx", "pdf"}, opts.ResearchWorkflow.PreferredExports)
	assert.Equal(t, "public_and_attached", opts.ResearchWorkflow.SourcePolicy)
}

func TestBuildOrchestrateTaskOptionsDisablesAutonomyWhenFlagOff(t *testing.T) {
	prevKey, hadKey := os.LookupEnv("STATSIG_SECRET_KEY")
	if err := os.Setenv("STATSIG_SECRET_KEY", "test-key"); err != nil {
		t.Fatalf("set env: %v", err)
	}
	ff.SetTestFlags(map[string]bool{})
	t.Cleanup(func() {
		ff.SetTestClient(nil)
		if hadKey {
			_ = os.Setenv("STATSIG_SECRET_KEY", prevKey)
			return
		}
		_ = os.Unsetenv("STATSIG_SECRET_KEY")
	})

	opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"autonomyEnabled": true,
		},
		UserID:    "123",
		UserEmail: "user@example.com",
	})

	if opts.AutonomyEnabled {
		t.Fatal("expected autonomy to be disabled when feature flag is off")
	}
}

func TestBuildOrchestrateTaskOptionsDisablesComputerUseWhenFlagOff(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "test-key")
	t.Setenv("GO_ENV", "production")
	ff.SetTestFlags(map[string]bool{})
	t.Cleanup(func() {
		ff.SetTestClient(nil)
	})

	opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"autonomyEnabled":    true,
			"computerUseEnabled": true,
		},
		UserID:    "123",
		UserEmail: "user@example.com",
	})

	assert.False(t, opts.AutonomyEnabled)
	assert.False(t, opts.ComputerUseEnabled)
}

func TestBuildOrchestrateTaskOptionsBypassesFeatureFlagsForExplicitLocalBypass(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "test-key")
	t.Setenv("TASKFORCE_BYPASS_FEATURE_FLAGS", "1")

	opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"autonomyEnabled":    true,
			"computerUseEnabled": true,
		},
		UserID:    "123",
		UserEmail: "local-dev@taskforceai.test",
	})

	if !opts.AutonomyEnabled {
		t.Fatal("expected autonomy to stay enabled for explicit local bypass")
	}
	if !opts.ComputerUseEnabled {
		t.Fatal("expected computer use to stay enabled for explicit local bypass")
	}
	assert.Equal(t, "virtual", opts.ComputerUseTarget)
}

func TestBuildOrchestrateTaskOptionsReadsComputerUseTarget(t *testing.T) {
	t.Setenv("GO_ENV", "development")

	local := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"computerUseEnabled": true,
			"computerUseTarget":  "local",
		},
	})
	assert.Equal(t, "local", local.ComputerUseTarget)

	virtual := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"computerUseEnabled": true,
		},
	})
	assert.Equal(t, "virtual", virtual.ComputerUseTarget)

	disabled := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"computerUseTarget": "local",
		},
	})
	assert.Empty(t, disabled.ComputerUseTarget)
}

func TestBuildOrchestrateTaskOptionsDenyLoggedInComputerUseForAPIAndDeveloperSources(t *testing.T) {
	t.Setenv("GO_ENV", "development")

	for _, source := range []string{"api", "developer"} {
		opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
			Options: map[string]any{
				"computerUseEnabled":  true,
				"useLoggedInServices": true,
			},
			Source: source,
		})
		assert.True(t, opts.ComputerUseEnabled)
		assert.False(t, opts.UseLoggedInServices, source)
	}

	web := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"computerUseEnabled":  true,
			"useLoggedInServices": true,
		},
		Source: "web",
	})
	assert.True(t, web.UseLoggedInServices)
}

func TestBuildOrchestrateTaskOptionsEnforcesFeatureFlagsForAdmins(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "")
	t.Setenv("GO_ENV", "production")

	opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"autonomyEnabled":    true,
			"computerUseEnabled": true,
		},
		UserID:    "123",
		UserEmail: "admin@example.com",
		IsAdmin:   true,
	})

	assert.False(t, opts.AutonomyEnabled)
	assert.False(t, opts.ComputerUseEnabled)
	assert.Empty(t, opts.ComputerUseTarget)
}

func TestBuildOrchestrateTaskOptionsFailsClosedForPrivilegedFeaturesWithoutStatsigInProduction(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "")
	t.Setenv("GO_ENV", "production")

	opts := BuildOrchestrateTaskOptions(BuildOptionsParams{
		Options: map[string]any{
			"autonomyEnabled":    true,
			"computerUseEnabled": true,
			"computerUseTarget":  "local",
		},
		UserID:    "123",
		UserEmail: "user@example.com",
	})

	assert.False(t, opts.AutonomyEnabled)
	assert.False(t, opts.ComputerUseEnabled)
	assert.Empty(t, opts.ComputerUseTarget)
}

func TestShouldEnforceRemoteFeatureFlagsDevelopmentBypass(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "test-key")
	t.Setenv("GO_ENV", "development")

	if shouldEnforceRemoteFeatureFlags() {
		t.Fatal("expected development environment to bypass remote feature flags")
	}
}

func TestShouldEnforceRemoteFeatureFlagsExplicitLocalBypass(t *testing.T) {
	t.Setenv("STATSIG_SECRET_KEY", "test-key")
	t.Setenv("TASKFORCE_BYPASS_FEATURE_FLAGS", "1")

	if shouldEnforceRemoteFeatureFlags() {
		t.Fatal("expected explicit local bypass to disable remote feature flag enforcement")
	}
}

func TestDetectAttachmentMIMEEdgeCases(t *testing.T) {
	assert.Equal(t, "application/octet-stream", DetectAttachmentMIME(nil))
	assert.Equal(t, "text/plain", DetectAttachmentMIME([]byte("plain text\n")))
}

func TestReadBoolOptionBranches(t *testing.T) {
	_, ok := ReadBoolOption(nil, "flag")
	assert.False(t, ok)
	_, ok = ReadBoolOption(map[string]any{"flag": "yes"}, "flag")
	assert.False(t, ok)
	value, ok := ReadBoolOption(map[string]any{"flag": true}, "flag")
	assert.True(t, ok)
	assert.True(t, value)
}

func TestReadIntOptionBranches(t *testing.T) {
	_, ok := ReadIntOption(nil, "count")
	assert.False(t, ok)
	_, ok = ReadIntOption(map[string]any{}, "count")
	assert.False(t, ok)
	_, ok = ReadIntOption(map[string]any{"count": "3"}, "count")
	assert.False(t, ok)
	_, ok = ReadIntOption(map[string]any{"count": 1.5}, "count")
	assert.False(t, ok)
	_, ok = ReadIntOption(map[string]any{"count": json.Number("bad")}, "count")
	assert.False(t, ok)

	value, ok := ReadIntOption(map[string]any{"count": 3}, "count")
	assert.True(t, ok)
	assert.Equal(t, 3, value)
	value, ok = ReadIntOption(map[string]any{"count": int32(2)}, "count")
	assert.True(t, ok)
	assert.Equal(t, 2, value)
	value, ok = ReadIntOption(map[string]any{"count": int64(5)}, "count")
	assert.True(t, ok)
	assert.Equal(t, 5, value)
	value, ok = ReadIntOption(map[string]any{"count": json.Number("6")}, "count")
	assert.True(t, ok)
	assert.Equal(t, 6, value)
	value, ok = ReadIntOption(map[string]any{"count": float64(4)}, "count")
	assert.True(t, ok)
	assert.Equal(t, 4, value)
}

func TestReadStringSliceOptionBranches(t *testing.T) {
	assert.Nil(t, ReadStringSliceOption(nil, "values"))
	assert.Nil(t, ReadStringSliceOption(map[string]any{"values": "bad"}, "values"))
	assert.Equal(t, []string{"one", "two"}, ReadStringSliceOption(map[string]any{
		"values": []any{" one ", "", 42, "two"},
	}, "values"))
}

func TestReadClientMCPTools(t *testing.T) {
	tools := ReadClientMCPTools(map[string]any{
		"clientTools": map[string]any{
			"mcp": []any{
				map[string]any{
					"serverName":  "linear",
					"toolName":    "create_issue",
					"title":       "Create issue",
					"description": "Creates an issue",
				},
				map[string]any{"serverName": "missing-tool-name"},
				"bad-record",
			},
		},
	})

	if len(tools) != 1 {
		t.Fatalf("expected one valid client MCP tool, got %d", len(tools))
	}
	if tools[0].ServerName != "linear" || tools[0].ToolName != "create_issue" {
		t.Fatalf("unexpected tool: %#v", tools[0])
	}

	if got := ReadClientMCPTools(nil); got != nil {
		t.Fatalf("expected nil tools for nil options, got %#v", got)
	}
	if got := ReadClientMCPTools(map[string]any{"clientTools": "bad"}); got != nil {
		t.Fatalf("expected nil tools for malformed options, got %#v", got)
	}
}

func TestReadClientMCPToolsMalformedAndValid(t *testing.T) {
	assert.Nil(t, ReadClientMCPTools(nil))
	assert.Nil(t, ReadClientMCPTools(map[string]any{"clientTools": "bad"}))
	assert.Nil(t, ReadClientMCPTools(map[string]any{"clientTools": map[string]any{"mcp": "bad"}}))
	assert.Empty(t, ReadClientMCPTools(map[string]any{
		"clientTools": map[string]any{"mcp": []any{42}},
	}))

	tools := ReadClientMCPTools(map[string]any{
		"clientTools": map[string]any{
			"mcp": []any{
				map[string]any{"serverName": "server", "toolName": "tool", "title": "Title", "description": "Desc"},
				map[string]any{"serverName": "", "toolName": ""},
			},
		},
	})
	require.Len(t, tools, 1)
	assert.Equal(t, "server", tools[0].ServerName)
}

func TestReadResearchWorkflowBranches(t *testing.T) {
	assert.True(t, ReadResearchWorkflow(nil).IsZero())
	assert.True(t, ReadResearchWorkflow(map[string]any{"researchWorkflow": "bad"}).IsZero())
	assert.True(t, ReadResearchWorkflow(map[string]any{
		"researchWorkflow": map[string]any{"sourcePolicy": "public_and_attached"},
	}).IsZero())

	workflow := ReadResearchWorkflow(map[string]any{
		"researchWorkflow": map[string]any{
			"workflow":          "credit_memo",
			"requiredCitations": false,
			"preferredExports":  []any{"docx", 42, ""},
			"sourcePolicy":      "attached_sources_only",
		},
	})
	assert.Equal(t, "credit_memo", workflow.Workflow)
	assert.False(t, workflow.RequiredCitations)
	assert.Equal(t, []string{"docx"}, workflow.PreferredExports)
	assert.Equal(t, "attached_sources_only", workflow.SourcePolicy)
}

func TestReadStringOptionBranches(t *testing.T) {
	assert.Empty(t, ReadStringOption(nil, "key"))
	assert.Empty(t, ReadStringOption(map[string]any{"key": 42}, "key"))
	assert.Equal(t, "value", ReadStringOption(map[string]any{"key": "value"}, "key"))
}

func TestResolveAttachmentsForUserFiltersUnauthorizedIDs(t *testing.T) {
	oldGet := runp.GetAttachment
	oldGetInfo := runp.GetAttachmentInfo
	t.Cleanup(func() {
		runp.GetAttachment = oldGet
		runp.GetAttachmentInfo = oldGetInfo
	})

	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		switch id {
		case "u:7:allowed":
			return []byte("allowed-data"), nil
		case "u:7:missing":
			return nil, errors.New("missing")
		default:
			return nil, errors.New("unexpected id")
		}
	}
	runp.GetAttachmentInfo = func(ctx context.Context, fileID string) (*runp.AttachmentInfo, bool, error) {
		return nil, false, nil
	}

	attachments, unauthorized := ResolveAttachmentsForUser(context.Background(), []string{
		"u:7:allowed",
		"u:999:forbidden",
		"u:7:missing",
		"legacy-unscoped-id",
	}, 7, nil)

	if len(unauthorized) != 2 {
		t.Fatalf("expected 2 unauthorized IDs, got %d (%v)", len(unauthorized), unauthorized)
	}
	if len(attachments.Files) != 1 {
		t.Fatalf("expected 1 resolved attachment, got %d", len(attachments.Files))
	}
	if attachments.Files[0].ID != "u:7:allowed" {
		t.Fatalf("unexpected attachment id %q", attachments.Files[0].ID)
	}
}

func TestResolveAttachmentsForUserUsesStoredMetadata(t *testing.T) {
	oldGet := runp.GetAttachment
	oldGetInfo := runp.GetAttachmentInfo
	t.Cleanup(func() {
		runp.GetAttachment = oldGet
		runp.GetAttachmentInfo = oldGetInfo
	})

	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		if id != "u:7:doc" {
			return nil, errors.New("unexpected id")
		}
		return []byte("PK\x03\x04\x14\x00\x06\x00"), nil
	}
	runp.GetAttachmentInfo = func(ctx context.Context, fileID string) (*runp.AttachmentInfo, bool, error) {
		if fileID != "u:7:doc" {
			return nil, false, errors.New("unexpected id")
		}
		return &runp.AttachmentInfo{
			MimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			Name:     "report.docx",
			Size:     128,
		}, true, nil
	}

	attachments, unauthorized := ResolveAttachmentsForUser(context.Background(), []string{"u:7:doc"}, 7, nil)
	if len(unauthorized) != 0 {
		t.Fatalf("expected no unauthorized IDs, got %v", unauthorized)
	}
	if len(attachments.Files) != 1 {
		t.Fatalf("expected 1 resolved attachment, got %d", len(attachments.Files))
	}
	if attachments.Files[0].MimeType != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("expected stored MIME type to be used, got %q", attachments.Files[0].MimeType)
	}
	if attachments.Files[0].Name != "report.docx" {
		t.Fatalf("expected stored filename to be used, got %q", attachments.Files[0].Name)
	}
	if attachments.Files[0].Size != 128 {
		t.Fatalf("expected stored size to be used, got %d", attachments.Files[0].Size)
	}
}

func TestResolveAttachmentsInvokesReadErrorCallback(t *testing.T) {
	oldGet := runp.GetAttachment
	oldGetInfo := runp.GetAttachmentInfo
	t.Cleanup(func() {
		runp.GetAttachment = oldGet
		runp.GetAttachmentInfo = oldGetInfo
	})

	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		return nil, errors.New("read failed")
	}
	runp.GetAttachmentInfo = func(ctx context.Context, fileID string) (*runp.AttachmentInfo, bool, error) {
		return nil, false, errors.New("info failed")
	}

	var readErrors []string
	attachments := ResolveAttachments(context.Background(), []string{"u:1:bad"}, func(id string, err error) {
		readErrors = append(readErrors, id+":"+err.Error())
	})
	assert.Empty(t, attachments.Files)
	assert.Len(t, readErrors, 1)
}

func TestResolveAttachmentsReportsInfoErrorAndUsesDetectedMetadata(t *testing.T) {
	oldGet := runp.GetAttachment
	oldGetInfo := runp.GetAttachmentInfo
	t.Cleanup(func() {
		runp.GetAttachment = oldGet
		runp.GetAttachmentInfo = oldGetInfo
	})

	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		return []byte("plain text"), nil
	}
	runp.GetAttachmentInfo = func(ctx context.Context, fileID string) (*runp.AttachmentInfo, bool, error) {
		return nil, false, errors.New("info failed")
	}

	var readErrors []string
	attachments := ResolveAttachments(context.Background(), []string{"u:1:file"}, func(id string, err error) {
		readErrors = append(readErrors, id+":"+err.Error())
	})
	require.Len(t, attachments.Files, 1)
	assert.Equal(t, "text/plain", attachments.Files[0].MimeType)
	assert.Equal(t, "attachment", attachments.Files[0].Name)
	assert.Equal(t, int64(len("plain text")), attachments.Files[0].Size)
	assert.Len(t, readErrors, 1)
}

func TestFirstNonEmptyBranches(t *testing.T) {
	assert.Equal(t, " value ", firstNonEmpty(" ", " value "))
	assert.Empty(t, firstNonEmpty(" ", ""))
}

func TestResolveUserPlanNilReturnsFree(t *testing.T) {
	assert.Equal(t, "free", ResolveUserPlan(nil))
}

func TestResolveUserPlanReturnsProvidedPlan(t *testing.T) {
	plan := "pro"
	assert.Equal(t, "pro", ResolveUserPlan(&plan))
}

func TestResolveRateLimitPlan(t *testing.T) {
	assert.Empty(t, ResolveRateLimitPlan(nil))
	plan := "super"
	assert.Equal(t, plan, ResolveRateLimitPlan(&plan))
}
