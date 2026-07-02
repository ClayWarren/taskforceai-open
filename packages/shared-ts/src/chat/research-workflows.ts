export type ResearchWorkflowId =
  | 'investment_dossier'
  | 'earnings_summary'
  | 'credit_memo'
  | 'valuation_snapshot';

export type ResearchWorkflowSourcePolicy =
  | 'public_and_attached'
  | 'mcp_and_web'
  | 'mcp_only'
  | 'attached_sources_only';

export type ResearchWorkflowExport = 'docx' | 'pdf' | 'xlsx';

export type ResearchWorkflowOption = {
  workflow: ResearchWorkflowId;
  requiredCitations: boolean;
  preferredExports: ResearchWorkflowExport[];
  sourcePolicy: ResearchWorkflowSourcePolicy;
};
