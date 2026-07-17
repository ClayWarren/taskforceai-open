import type { ResearchWorkflowOption } from '@taskforceai/client-core';
import { attachmentMetadataCollectionSchema } from '@taskforceai/client-core/validation';
import { insertMcpToolCommandIntoPrompt } from '@taskforceai/presenters';
import type React from 'react';

import { createLargePasteAttachment, getLargePasteContent } from '../composer/largePasteAttachment';
import { insertPromptTemplateIntoPrompt, type PromptTemplate } from '../composer/promptTemplates';

interface CreatePromptContentActionsOptions {
  addFile: (file: File) => void;
  files: File[];
  prompt: string;
  removeFile: (index: number) => void;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  setSelectedResearchWorkflow: React.Dispatch<React.SetStateAction<ResearchWorkflowOption | null>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export const createPromptContentActions = ({
  addFile,
  files,
  prompt,
  removeFile,
  setPrompt,
  setSelectedResearchWorkflow,
  textareaRef,
}: CreatePromptContentActionsOptions) => {
  const handleLargePaste = (content: string) => {
    const file = createLargePasteAttachment(content);
    const result = attachmentMetadataCollectionSchema.safeParse(
      [...files, file].map((attachment) => ({
        name: attachment.name,
        size: attachment.size,
        mimeType: attachment.type,
      }))
    );
    if (!result.success) {
      return false;
    }

    addFile(file);
    return true;
  };

  const handleShowAttachmentInTextField = (index: number) => {
    const file = files[index];
    if (!file) {
      return;
    }
    const content = getLargePasteContent(file);
    if (content === null) {
      return;
    }

    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? prompt.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextSelection = selectionStart + content.length;
    removeFile(index);
    setPrompt(
      (previous) => `${previous.slice(0, selectionStart)}${content}${previous.slice(selectionEnd)}`
    );
    if (textarea) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextSelection, nextSelection);
      });
    }
  };

  const handleInsertMcpTool = (serverName: string, toolName: string) => {
    setPrompt((previous) =>
      insertMcpToolCommandIntoPrompt({
        prompt: previous,
        serverName,
        toolName,
      })
    );
  };

  const handleInsertPromptTemplate = (template: PromptTemplate) => {
    setSelectedResearchWorkflow(template.workflow ?? null);
    setPrompt((previous) => insertPromptTemplateIntoPrompt(previous, template));
    textareaRef.current?.focus();
  };

  return {
    handleInsertMcpTool,
    handleInsertPromptTemplate,
    handleLargePaste,
    handleShowAttachmentInTextField,
  };
};
