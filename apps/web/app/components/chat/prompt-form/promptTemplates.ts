import type { ResearchWorkflowOption } from '@taskforceai/shared';

export type PromptTemplateCategory =
  | 'research'
  | 'agent-teams'
  | 'computer-use'
  | 'files'
  | 'create'
  | 'code';

export type PromptTemplateId =
  | 'investment-dossier'
  | 'earnings-summary'
  | 'credit-memo'
  | 'valuation-snapshot'
  | 'agent-team-plan'
  | 'computer-use-website'
  | 'logged-in-workflow'
  | 'summarize-attachments'
  | 'refresh-spreadsheet'
  | 'generate-media'
  | 'draft-document'
  | 'review-code'
  | 'debug-failing-test';

export interface PromptTemplate {
  id: PromptTemplateId;
  category: PromptTemplateCategory;
  label: string;
  description: string;
  workflow?: ResearchWorkflowOption;
  prompt: string;
}

export const PROMPT_TEMPLATE_CATEGORY_LABELS: Record<PromptTemplateCategory, string> = {
  research: 'Research',
  'agent-teams': 'Agent teams',
  'computer-use': 'Computer Use',
  files: 'Files and data',
  create: 'Create',
  code: 'Code',
};

export const PROMPT_TEMPLATE_CATEGORIES: PromptTemplateCategory[] = [
  'research',
  'agent-teams',
  'computer-use',
  'files',
  'create',
  'code',
];

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'investment-dossier',
    category: 'research',
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
    category: 'research',
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
    category: 'research',
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
    category: 'research',
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
  {
    id: 'agent-team-plan',
    category: 'agent-teams',
    label: 'Agent team plan',
    description: 'Split a complex task into roles',
    prompt:
      'Use an agent team to handle [task]. Start by assigning clear roles, then have each agent investigate a distinct part of the problem. Synthesize the findings into a concise recommendation with open questions and next actions.',
  },
  {
    id: 'computer-use-website',
    category: 'computer-use',
    label: 'Use a website',
    description: 'Navigate and gather information',
    prompt:
      'Use Computer Use to visit [website or app] and complete this task: [task]. Keep track of important pages, fields, results, and any blockers. Summarize what changed or what you found.',
  },
  {
    id: 'logged-in-workflow',
    category: 'computer-use',
    label: 'Logged-in workflow',
    description: 'Use existing authenticated sessions',
    prompt:
      'Use logged-in Computer Use for [service or website] to complete [workflow]. Confirm each important action before submitting irreversible changes, and summarize the final state.',
  },
  {
    id: 'summarize-attachments',
    category: 'files',
    label: 'Summarize attachments',
    description: 'Pull out decisions and risks',
    prompt:
      'Summarize the attached files. Extract key facts, decisions, risks, deadlines, owners, and follow-up questions. Cite the relevant file names or document sections for important claims.',
  },
  {
    id: 'refresh-spreadsheet',
    category: 'files',
    label: 'Refresh spreadsheet',
    description: 'Update assumptions and outputs',
    prompt:
      'Review the attached spreadsheet and refresh the relevant assumptions for [scenario]. Explain which cells, tabs, or formulas changed, then summarize the impact on the main outputs.',
  },
  {
    id: 'generate-media',
    category: 'create',
    label: 'Generate media',
    description: 'Create image or video assets',
    prompt:
      'Create a polished [image or video] for [purpose]. Style: [visual direction]. Include the key subject, composition, mood, colors, and any text that must appear exactly.',
  },
  {
    id: 'draft-document',
    category: 'create',
    label: 'Draft document',
    description: 'Produce a structured artifact',
    prompt:
      'Draft a [document, memo, report, or presentation] for [audience]. Use a clear structure, include an executive summary, organize supporting details, and produce an artifact when complete.',
  },
  {
    id: 'review-code',
    category: 'code',
    label: 'Review code',
    description: 'Find bugs and risky changes',
    prompt:
      'Review [files, branch, or module] for bugs, regressions, security issues, and missing tests. Prioritize concrete findings with file references and reproduction or reasoning.',
  },
  {
    id: 'debug-failing-test',
    category: 'code',
    label: 'Debug failing test',
    description: 'Trace failure to root cause',
    prompt:
      'Debug this failing test or command: [command and failure]. Reproduce it, identify the root cause, make the smallest safe fix, and rerun the relevant verification.',
  },
];

export const insertPromptTemplateIntoPrompt = (
  currentPrompt: string,
  template: PromptTemplate
): string => {
  const trimmedPrompt = currentPrompt.trimEnd();
  if (!trimmedPrompt) {
    return template.prompt;
  }
  return `${trimmedPrompt}\n\n${template.prompt}`;
};
