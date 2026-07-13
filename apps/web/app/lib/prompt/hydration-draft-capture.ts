export const PROMPT_DRAFT_CAPTURE_KEY = '__TASKFORCEAI_PROMPT_DRAFT__';
export const PROMPT_DRAFT_CAPTURE_SELECTION_KEY = '__TASKFORCEAI_PROMPT_DRAFT_SELECTION__';
export const PROMPT_DRAFT_CAPTURE_INSTALLED_KEY = '__TASKFORCEAI_PROMPT_DRAFT_CAPTURE_INSTALLED__';
export const PROMPT_DRAFT_CAPTURE_EVENT = 'taskforceai:prompt-draft-captured';
export const PROMPT_DRAFT_CAPTURE_SCRIPT_SRC = '/prompt-draft-capture.js';

type PromptDraftSelection = {
  value: string;
  start: number;
  end: number;
  direction: 'backward' | 'forward' | 'none';
};

type PromptDraftWindow = Window & {
  __TASKFORCEAI_PROMPT_DRAFT__?: unknown;
  __TASKFORCEAI_PROMPT_DRAFT_SELECTION__?: unknown;
  __TASKFORCEAI_PROMPT_DRAFT_CAPTURE_INSTALLED__?: boolean;
};

const isPromptTextarea = (target: EventTarget | null): target is HTMLTextAreaElement =>
  typeof HTMLTextAreaElement !== 'undefined' &&
  target instanceof HTMLTextAreaElement &&
  target.id === 'prompt';

const readSelection = (textarea: HTMLTextAreaElement): PromptDraftSelection | null => {
  const { selectionStart, selectionEnd, selectionDirection, value } = textarea;
  if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number') {
    return null;
  }

  return {
    value,
    start: selectionStart,
    end: selectionEnd,
    direction:
      selectionDirection === 'backward' || selectionDirection === 'forward'
        ? selectionDirection
        : 'none',
  };
};

export const readCapturedPromptDraft = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  const value = (window as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_KEY];
  return typeof value === 'string' ? value : '';
};

export const installPromptDraftCapture = (targetWindow: Window = window): void => {
  const promptDraftWindow = targetWindow as PromptDraftWindow;
  if (promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT_CAPTURE_INSTALLED__) {
    return;
  }
  promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT_CAPTURE_INSTALLED__ = true;

  const capturePromptDraft = (event: Event) => {
    const target = event.target;
    if (!isPromptTextarea(target)) {
      return;
    }

    promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT__ = target.value;
    promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT_SELECTION__ = readSelection(target);
    targetWindow.dispatchEvent(
      new CustomEvent(PROMPT_DRAFT_CAPTURE_EVENT, {
        detail: { value: target.value },
      })
    );
  };

  targetWindow.document.addEventListener('input', capturePromptDraft, true);
  targetWindow.document.addEventListener('change', capturePromptDraft, true);

  const existingPrompt = targetWindow.document.getElementById('prompt');
  if (isPromptTextarea(existingPrompt) && existingPrompt.value) {
    promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT__ = existingPrompt.value;
    promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT_SELECTION__ = readSelection(existingPrompt);
  }
};

export const writeCapturedPromptDraft = (value: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  (window as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_KEY] = value;
};

const clampSelectionOffset = (offset: number, max: number): number =>
  Math.min(Math.max(offset, 0), max);

const parseCapturedPromptDraftSelection = (value: unknown): PromptDraftSelection | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const selection = value as Partial<PromptDraftSelection>;
  if (
    typeof selection.value !== 'string' ||
    typeof selection.start !== 'number' ||
    typeof selection.end !== 'number'
  ) {
    return null;
  }

  return {
    value: selection.value,
    start: selection.start,
    end: selection.end,
    direction:
      selection.direction === 'backward' || selection.direction === 'forward'
        ? selection.direction
        : 'none',
  };
};

export const restoreCapturedPromptDraftSelection = (
  textarea: HTMLTextAreaElement | null,
  value: string,
  targetWindow: Window = window
): boolean => {
  if (!textarea || !isPromptTextarea(textarea)) {
    return false;
  }

  const promptDraftWindow = targetWindow as PromptDraftWindow;
  const selection = parseCapturedPromptDraftSelection(
    promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT_SELECTION__
  );
  if (!selection || selection.value !== value || textarea.value !== value) {
    return false;
  }

  const max = value.length;
  const start = clampSelectionOffset(selection.start, max);
  const end = clampSelectionOffset(selection.end, max);
  textarea.setSelectionRange(start, end, selection.direction);
  delete promptDraftWindow.__TASKFORCEAI_PROMPT_DRAFT_SELECTION__;
  return true;
};
