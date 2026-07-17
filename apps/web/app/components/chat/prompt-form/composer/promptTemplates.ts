import {
  RESEARCH_WORKFLOW_PROMPT_TEMPLATES,
  type ResearchWorkflowOption,
  type ResearchWorkflowPromptTemplateId,
} from '@taskforceai/client-core';

export type PromptTemplateCategory =
  | 'research'
  | 'agent-teams'
  | 'computer-use'
  | 'files'
  | 'create'
  | 'code';

type PromptTemplateId =
  | ResearchWorkflowPromptTemplateId
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
  ...RESEARCH_WORKFLOW_PROMPT_TEMPLATES.map((template) =>
    Object.assign({}, template, { category: 'research' as const })
  ),
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
