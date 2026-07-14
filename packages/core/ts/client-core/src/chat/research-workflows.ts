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

export type ResearchWorkflowPromptTemplateId =
  | 'investment-dossier'
  | 'earnings-summary'
  | 'credit-memo'
  | 'valuation-snapshot';

export type ResearchWorkflowPromptTemplate = {
  id: ResearchWorkflowPromptTemplateId;
  label: string;
  description: string;
  workflow: ResearchWorkflowOption;
  prompt: string;
};

export const RESEARCH_WORKFLOW_PROMPT_TEMPLATES: ResearchWorkflowPromptTemplate[] = [
  {
    id: 'investment-dossier',
    label: 'Investment dossier',
    description: 'Public-source company diligence',
    workflow: {
      workflow: 'investment_dossier',
      requiredCitations: true,
      preferredExports: ['docx', 'pdf'],
      sourcePolicy: 'public_and_attached',
    },
    prompt:
      'Create an investment dossier for [company or ticker]. Use free public sources first: SEC EDGAR filings and data.sec.gov, company investor-relations pages, company press releases, public earnings materials, attached PDFs, decks, and spreadsheets, and general web sources where relevant. Do not rely on paid market-data providers unless the user explicitly attaches that data. Structure the output with an executive summary, business overview, leadership notes, recent financial performance, valuation context, catalysts, risks, and open diligence questions. Cite each material claim with source titles and URLs or document references. When complete, create Word and PDF artifacts for the dossier.',
  },
  {
    id: 'earnings-summary',
    label: 'Earnings summary',
    description: 'Results, guidance, and surprises',
    workflow: {
      workflow: 'earnings_summary',
      requiredCitations: true,
      preferredExports: [],
      sourcePolicy: 'public_and_attached',
    },
    prompt:
      'Prepare an earnings summary for [company or ticker] covering the most recent reported period. Use free public sources first: SEC EDGAR filings and data.sec.gov, company investor-relations pages, company press releases, public earnings materials, attached transcripts, decks, and spreadsheets, and general web sources where relevant. Do not rely on paid market-data providers unless the user explicitly attaches that data. Include headline results, guidance, segment performance, margin and cash-flow drivers, management commentary, analyst questions, surprises versus expectations, and follow-up items. Cite each material claim with source titles and URLs or document references.',
  },
  {
    id: 'credit-memo',
    label: 'Credit memo',
    description: 'Borrower risk and recommendation',
    workflow: {
      workflow: 'credit_memo',
      requiredCitations: true,
      preferredExports: ['docx'],
      sourcePolicy: 'public_and_attached',
    },
    prompt:
      'Draft a credit memo for [company, borrower, or issuer]. Use free public sources first: SEC EDGAR filings and data.sec.gov, company investor-relations pages, company press releases, public debt and liquidity disclosures, attached internal documents, financial models, PDFs, and spreadsheets, and general web sources where relevant. Do not rely on paid rating reports or market-data providers unless the user explicitly attaches that data. Cover borrower overview, debt structure, liquidity, leverage, covenant considerations, downside risks, mitigants, recommendation, and monitoring triggers. Cite each material claim with source titles and URLs or document references. When complete, create a Word artifact for the memo.',
  },
  {
    id: 'valuation-snapshot',
    label: 'Valuation snapshot',
    description: 'Comps, assumptions, and sensitivities',
    workflow: {
      workflow: 'valuation_snapshot',
      requiredCitations: true,
      preferredExports: ['xlsx'],
      sourcePolicy: 'public_and_attached',
    },
    prompt:
      'Build a valuation snapshot for [company or ticker]. Use free public sources first: SEC EDGAR filings and data.sec.gov, company investor-relations pages, company press releases, public market pages, attached model spreadsheets, PDFs, and decks, and general web sources where relevant. Do not rely on paid market-data providers unless the user explicitly attaches that data. Include comparable companies, key multiples, growth and margin assumptions, sensitivity ranges, bear/base/bull framing, and the biggest evidence gaps. Cite each material claim with source titles and URLs or document references. If spreadsheet data is attached, refresh the relevant model assumptions before summarizing.',
  },
];
