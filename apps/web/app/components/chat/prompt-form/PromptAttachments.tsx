import React from 'react';

import { getLargePasteContent } from './largePasteAttachment';

interface PromptAttachmentsProps {
  files: File[];
  onRemove: (index: number) => void;
  onShowInTextField: (index: number) => void;
}

export const PromptAttachments: React.FC<PromptAttachmentsProps> = ({
  files,
  onRemove,
  onShowInTextField,
}) => {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-1 pt-2 pb-1" aria-live="polite">
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          className="group relative flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
        >
          <span className="max-w-[150px] truncate">{file.name}</span>
          {getLargePasteContent(file) !== null ? (
            <button
              type="button"
              onClick={() => onShowInTextField(index)}
              className="ml-1 font-medium text-blue-200 transition-colors hover:text-blue-100"
            >
              Show in text field
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] leading-none transition-colors hover:bg-white/40"
            title={`Remove ${file.name}`}
            aria-label={`Remove ${file.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
