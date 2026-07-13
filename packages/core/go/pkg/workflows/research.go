package workflows

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	ResearchWorkflowInvestmentDossier = "investment_dossier"
	ResearchWorkflowEarningsSummary   = "earnings_summary"
	ResearchWorkflowCreditMemo        = "credit_memo"
	ResearchWorkflowValuationSnapshot = "valuation_snapshot"

	ResearchWorkflowSourcePublicAndAttached = "public_and_attached"
	ResearchWorkflowSourceMCPAndWeb         = "mcp_and_web"
	ResearchWorkflowSourceMCPOnly           = "mcp_only"
	ResearchWorkflowSourceAttachedOnly      = "attached_sources_only"
)

type ResearchWorkflowOption struct {
	Workflow          string   `json:"workflow,omitempty"`
	RequiredCitations bool     `json:"requiredCitations,omitempty"`
	PreferredExports  []string `json:"preferredExports,omitempty"`
	SourcePolicy      string   `json:"sourcePolicy,omitempty"`
}

func (o *ResearchWorkflowOption) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" || !strings.HasPrefix(trimmed, "{") {
		*o = ResearchWorkflowOption{}
		return nil
	}

	type researchWorkflowOptionAlias ResearchWorkflowOption
	var decoded researchWorkflowOptionAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*o = ResearchWorkflowOption(decoded)
	return nil
}

func (o ResearchWorkflowOption) IsZero() bool {
	return strings.TrimSpace(o.Workflow) == ""
}

func ApplyResearchWorkflowInstructions(projectInstructions string, workflow ResearchWorkflowOption) string {
	if workflow.IsZero() {
		return projectInstructions
	}

	section := buildResearchWorkflowInstructionSection(workflow)
	if strings.TrimSpace(projectInstructions) == "" {
		return section
	}
	return projectInstructions + "\n\n" + section
}

func buildResearchWorkflowInstructionSection(workflow ResearchWorkflowOption) string {
	label := researchWorkflowLabel(workflow.Workflow)
	sourcePolicy := researchWorkflowSourcePolicyInstruction(workflow.SourcePolicy)
	citationInstruction := "Citations: cite every material claim with source titles and URLs or document references."
	if !workflow.RequiredCitations {
		citationInstruction = "Citations: cite sourced claims when source material is used."
	}

	exports := "Preferred exports: none requested."
	if len(workflow.PreferredExports) > 0 {
		exports = fmt.Sprintf("Preferred exports: %s.", strings.Join(workflow.PreferredExports, ", "))
	}

	return strings.Join([]string{
		"[FINANCE RESEARCH WORKFLOW]",
		fmt.Sprintf("Workflow: %s", label),
		sourcePolicy,
		"Free-source priority: use SEC EDGAR and data.sec.gov, company investor-relations pages, company press releases, public earnings materials, attached PDFs/decks/spreadsheets, and general web sources before any other data source.",
		"Paid-provider constraint: do not rely on paid market-data, ratings, transcript, expert-network, or news providers unless the user explicitly attaches that data in the conversation.",
		citationInstruction,
		exports,
	}, "\n")
}

func researchWorkflowLabel(workflow string) string {
	switch strings.TrimSpace(workflow) {
	case ResearchWorkflowInvestmentDossier:
		return "investment dossier"
	case ResearchWorkflowEarningsSummary:
		return "earnings summary"
	case ResearchWorkflowCreditMemo:
		return "credit memo"
	case ResearchWorkflowValuationSnapshot:
		return "valuation snapshot"
	default:
		return strings.TrimSpace(workflow)
	}
}

func researchWorkflowSourcePolicyInstruction(sourcePolicy string) string {
	switch strings.TrimSpace(sourcePolicy) {
	case ResearchWorkflowSourceAttachedOnly:
		return "Source policy: use attached files only unless the user explicitly asks for outside research."
	case ResearchWorkflowSourceMCPOnly:
		return "Source policy: use enabled MCP tools only and avoid open-web research unless the user explicitly asks for it."
	case ResearchWorkflowSourceMCPAndWeb:
		return "Source policy: use enabled MCP tools and web sources, preferring free public sources."
	default:
		return "Source policy: use public and attached sources only."
	}
}
