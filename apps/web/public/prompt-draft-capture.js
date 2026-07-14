// @ts-check

(() => {
  const draftKey = '__TASKFORCEAI_PROMPT_DRAFT__';
  const selectionKey = '__TASKFORCEAI_PROMPT_DRAFT_SELECTION__';
  const installedKey = '__TASKFORCEAI_PROMPT_DRAFT_CAPTURE_INSTALLED__';
  const eventName = 'taskforceai:prompt-draft-captured';
  /** @type {Record<string, unknown>} */
  const draftWindow = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window));

  if (draftWindow[installedKey]) {
    return;
  }
  draftWindow[installedKey] = true;

  /** @param {Event} event */
  const capturePromptDraft = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.id !== 'prompt') {
      return;
    }

    draftWindow[draftKey] = target.value;
    draftWindow[selectionKey] = {
      value: target.value,
      start: target.selectionStart,
      end: target.selectionEnd,
      direction: target.selectionDirection || 'none',
    };
    window.dispatchEvent(new CustomEvent(eventName, { detail: { value: target.value } }));
  };

  document.addEventListener('input', capturePromptDraft, true);
  document.addEventListener('change', capturePromptDraft, true);

  const existingPrompt = document.getElementById('prompt');
  if (existingPrompt instanceof HTMLTextAreaElement && existingPrompt.value) {
    draftWindow[draftKey] = existingPrompt.value;
    draftWindow[selectionKey] = {
      value: existingPrompt.value,
      start: existingPrompt.selectionStart,
      end: existingPrompt.selectionEnd,
      direction: existingPrompt.selectionDirection || 'none',
    };
  }
})();
