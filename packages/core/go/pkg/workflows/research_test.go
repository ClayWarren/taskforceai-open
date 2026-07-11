package workflows

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyResearchWorkflowInstructions(t *testing.T) {
	unchanged := ApplyResearchWorkflowInstructions("existing", ResearchWorkflowOption{})
	assert.Equal(t, "existing", unchanged)

	instructions := ApplyResearchWorkflowInstructions("base", ResearchWorkflowOption{
		Workflow:          ResearchWorkflowInvestmentDossier,
		RequiredCitations: true,
		PreferredExports:  []string{"docx", "pdf"},
		SourcePolicy:      ResearchWorkflowSourcePublicAndAttached,
	})
	assert.Contains(t, instructions, "base\n\n[FINANCE RESEARCH WORKFLOW]")
	assert.Contains(t, instructions, "investment dossier")
	assert.Contains(t, instructions, "Preferred exports: docx, pdf.")
	assert.Contains(t, instructions, "cite every material claim")

	attachedOnly := ApplyResearchWorkflowInstructions("", ResearchWorkflowOption{
		Workflow:     ResearchWorkflowCreditMemo,
		SourcePolicy: ResearchWorkflowSourceAttachedOnly,
	})
	assert.Contains(t, attachedOnly, "use attached files only")
	assert.NotContains(t, attachedOnly, "base")
}

func TestResearchWorkflowBranchHelpers(t *testing.T) {
	var option ResearchWorkflowOption
	require.NoError(t, json.Unmarshal([]byte(`null`), &option))
	assert.True(t, option.IsZero())
	require.NoError(t, option.UnmarshalJSON([]byte(`   `)))
	assert.True(t, option.IsZero())
	require.NoError(t, json.Unmarshal([]byte(`"bad"`), &option))
	assert.True(t, option.IsZero())
	require.NoError(t, json.Unmarshal([]byte(`{"workflow":"earnings_summary","requiredCitations":true}`), &option))
	assert.Equal(t, ResearchWorkflowEarningsSummary, option.Workflow)
	assert.True(t, option.RequiredCitations)
	require.Error(t, option.UnmarshalJSON([]byte("{")))

	assert.Equal(t, "earnings summary", researchWorkflowLabel(ResearchWorkflowEarningsSummary))
	assert.Equal(t, "valuation snapshot", researchWorkflowLabel(ResearchWorkflowValuationSnapshot))
	assert.Equal(t, "custom", researchWorkflowLabel(" custom "))

	assert.Contains(t, researchWorkflowSourcePolicyInstruction(ResearchWorkflowSourceMCPOnly), "MCP tools only")
	assert.Contains(t, researchWorkflowSourcePolicyInstruction(ResearchWorkflowSourceMCPAndWeb), "web sources")
	assert.Contains(t, researchWorkflowSourcePolicyInstruction(""), "public and attached")

	section := buildResearchWorkflowInstructionSection(ResearchWorkflowOption{
		Workflow:          "custom",
		RequiredCitations: false,
	})
	assert.Contains(t, section, "cite sourced claims")
	assert.Contains(t, section, "Preferred exports: none requested.")
}
