import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../../../../tests/setup/dom';

import { createLargePasteAttachment } from '../composer/largePasteAttachment';
import { createPromptContentActions } from './createPromptContentActions';

describe('createPromptContentActions', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('restores a large paste at the current selection and refocuses the textarea', () => {
    const focus = mock();
    const setSelectionRange = mock();
    const textarea = {
      focus,
      selectionEnd: 7,
      selectionStart: 7,
      setSelectionRange,
    } as unknown as HTMLTextAreaElement;
    globalThis.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    const removeFile = mock();
    let nextPrompt = '';
    const actions = createPromptContentActions({
      addFile: mock(),
      files: [createLargePasteAttachment('inserted ')],
      prompt: 'before after',
      removeFile,
      setPrompt: (updater) => {
        nextPrompt = typeof updater === 'function' ? updater('before after') : updater;
      },
      setSelectedResearchWorkflow: mock(),
      textareaRef: { current: textarea },
    });

    actions.handleShowAttachmentInTextField(0);

    expect(removeFile).toHaveBeenCalledWith(0);
    expect(nextPrompt).toBe('before inserted after');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(setSelectionRange).toHaveBeenCalledWith(16, 16);
  });
});
