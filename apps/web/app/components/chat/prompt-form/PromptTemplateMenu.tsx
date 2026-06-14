import {
  Bot,
  Code2,
  FileText,
  LibraryBig,
  Monitor,
  Paintbrush,
  Search,
  Table2,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit';
import type { PromptTemplate, PromptTemplateCategory } from './promptTemplates';
import { PROMPT_TEMPLATE_CATEGORIES, PROMPT_TEMPLATE_CATEGORY_LABELS } from './promptTemplates';

interface PromptTemplateMenuProps {
  templates: PromptTemplate[];
  disabled: boolean;
  onInsertTemplate: (_template: PromptTemplate) => void;
}

const categoryIcons: Record<PromptTemplateCategory, typeof Search> = {
  research: Search,
  'agent-teams': Bot,
  'computer-use': Monitor,
  files: Table2,
  create: Paintbrush,
  code: Code2,
};

export function PromptTemplateMenu({
  templates,
  disabled,
  onInsertTemplate,
}: PromptTemplateMenuProps) {
  if (templates.length === 0) {
    return null;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs font-medium text-white/80 transition-colors hover:border-blue-300/45 hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          disabled={disabled}
          aria-label="Prompts"
          title="Prompts"
        >
          <LibraryBig aria-hidden="true" size={15} strokeWidth={2.1} />
          <span className="hidden sm:inline">Prompts</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="max-h-[min(520px,calc(100vh-9rem))] w-[340px] overflow-y-auto rounded-lg border border-white/10 bg-[#111827] p-2 text-white shadow-[0_18px_50px_rgba(2,6,23,0.55)]"
      >
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">
          Prompts
        </DropdownMenuLabel>
        {PROMPT_TEMPLATE_CATEGORIES.map((category, categoryIndex) => {
          const categoryTemplates = templates.filter((template) => template.category === category);
          if (categoryTemplates.length === 0) {
            return null;
          }
          const Icon = categoryIcons[category];
          return (
            <div key={category}>
              {categoryIndex > 0 ? <DropdownMenuSeparator className="my-1 bg-white/10" /> : null}
              <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                <Icon aria-hidden="true" size={13} strokeWidth={2.1} />
                <span>{PROMPT_TEMPLATE_CATEGORY_LABELS[category]}</span>
              </div>
              {categoryTemplates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() => onInsertTemplate(template)}
                  className="cursor-pointer rounded-md px-2 py-2 focus:bg-blue-400/14 focus:text-white"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                      <FileText aria-hidden="true" size={14} strokeWidth={2.1} />
                      <span>{template.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-slate-400">
                      {template.description}
                    </p>
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
