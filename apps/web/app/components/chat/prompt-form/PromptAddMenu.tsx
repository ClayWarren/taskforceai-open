import { FileUp, LibraryBig, Plus } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@taskforceai/ui-kit/tooltip';
import { PromptTemplateMenuItems } from './PromptTemplateMenu';
import type { PromptTemplate } from './promptTemplates';

interface PromptAddMenuProps {
  buttonClassName: string;
  disabled: boolean;
  onFileButtonClick: () => void;
  onInsertPromptTemplate: (_template: PromptTemplate) => void;
  promptTemplates: PromptTemplate[];
}

export function PromptAddMenu({
  buttonClassName,
  disabled,
  onFileButtonClick,
  onInsertPromptTemplate,
  promptTemplates,
}: PromptAddMenuProps) {
  const hasPromptTemplates = promptTemplates.length > 0;

  return (
    <DropdownMenu modal={false}>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`${buttonClassName} prompt-bare-icon-button text-white`}
                disabled={disabled}
                aria-disabled={disabled}
                aria-label="Add files and more"
                title="Add files and more"
              >
                <Plus aria-hidden="true" size={22} strokeWidth={2.15} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="prompt-control-tooltip">
            Add files and more
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="prompt-add-menu w-[250px] rounded-lg border border-white/10 bg-[#111827] p-2 text-white shadow-[0_18px_50px_rgba(2,6,23,0.55)]"
      >
        <DropdownMenuItem
          disabled={disabled}
          onSelect={() => onFileButtonClick()}
          className="cursor-pointer rounded-md px-2 py-2 focus:bg-blue-400/14 focus:text-white"
        >
          <FileUp aria-hidden="true" size={15} strokeWidth={2.1} />
          <span>Add files</span>
        </DropdownMenuItem>
        {hasPromptTemplates ? (
          <>
            <DropdownMenuSeparator className="my-1 bg-white/10" />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer rounded-md px-2 py-2 text-slate-100 focus:bg-blue-400/14 focus:text-white data-[state=open]:bg-blue-400/14 data-[state=open]:text-white">
                <LibraryBig aria-hidden="true" size={15} strokeWidth={2.1} />
                <span>Prompts</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[min(520px,calc(100vh-9rem))] w-[340px] overflow-y-auto rounded-lg border border-white/10 bg-[#111827] p-2 text-white shadow-[0_18px_50px_rgba(2,6,23,0.55)]">
                <PromptTemplateMenuItems
                  templates={promptTemplates}
                  onInsertTemplate={onInsertPromptTemplate}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
