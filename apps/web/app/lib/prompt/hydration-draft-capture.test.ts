import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import '../../../../../tests/setup/dom';
import {
  PROMPT_DRAFT_CAPTURE_INSTALLED_KEY,
  PROMPT_DRAFT_CAPTURE_KEY,
  PROMPT_DRAFT_CAPTURE_SELECTION_KEY,
  installPromptDraftCapture,
  readCapturedPromptDraft,
  restoreCapturedPromptDraftSelection,
  writeCapturedPromptDraft,
} from './hydration-draft-capture';

type PromptDraftWindow = Window & {
  __TASKFORCEAI_PROMPT_DRAFT__?: unknown;
  __TASKFORCEAI_PROMPT_DRAFT_SELECTION__?: unknown;
  __TASKFORCEAI_PROMPT_DRAFT_CAPTURE_INSTALLED__?: boolean;
};

type PromptDraftBrowserWindow = Window &
  Pick<typeof globalThis, 'CustomEvent' | 'Event' | 'HTMLTextAreaElement'>;

const publicCaptureScript = () =>
  readFileSync(resolve(process.cwd(), 'apps/web/public/prompt-draft-capture.js'), 'utf8');

const runPublicCaptureScript = (targetWindow: Window = window) => {
  const browserWindow = targetWindow as PromptDraftBrowserWindow;
  runInContext(
    publicCaptureScript(),
    createContext({
      window: browserWindow,
      document: browserWindow.document,
      HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
      CustomEvent: browserWindow.CustomEvent,
    })
  );
};

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_KEY];
  delete (window as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_SELECTION_KEY];
  delete (window as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_INSTALLED_KEY];
});

describe('hydration prompt draft capture', () => {
  it('captures prompt input before React owns the textarea', () => {
    installPromptDraftCapture(window);
    document.body.innerHTML = '<textarea id="prompt"></textarea>';
    const textarea = document.getElementById('prompt') as HTMLTextAreaElement;

    textarea.value = 'typed before hydration';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(readCapturedPromptDraft()).toBe('typed before hydration');
  });

  it('restores the captured prompt caret after React adopts the draft', () => {
    installPromptDraftCapture(window);
    document.body.innerHTML = '<textarea id="prompt"></textarea>';
    const textarea = document.getElementById('prompt') as HTMLTextAreaElement;

    textarea.focus();
    textarea.value = 'typed before hydration';
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.setSelectionRange(0, 0);

    expect(restoreCapturedPromptDraftSelection(textarea, 'typed before hydration')).toBe(true);
    expect(textarea.selectionStart).toBe('typed before hydration'.length);
    expect(textarea.selectionEnd).toBe('typed before hydration'.length);
  });

  it('stores and reads controlled prompt updates', () => {
    writeCapturedPromptDraft('controlled draft');

    expect(readCapturedPromptDraft()).toBe('controlled draft');
  });

  it('captures prompt drafts from the shipped public script exactly once', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const targetWindow = frame.contentWindow;
    if (!targetWindow) {
      throw new Error('Expected iframe window for public prompt draft capture test');
    }
    const browserWindow = targetWindow as PromptDraftBrowserWindow;
    targetWindow.document.body.innerHTML = `
      <textarea id="prompt">existing draft</textarea>
      <textarea id="other">ignored draft</textarea>
    `;
    const textarea = targetWindow.document.getElementById('prompt') as HTMLTextAreaElement;
    textarea.setSelectionRange(2, 6, 'forward');
    const capturedEvents: string[] = [];
    targetWindow.addEventListener('taskforceai:prompt-draft-captured', (event) => {
      capturedEvents.push((event as CustomEvent<{ value: string }>).detail.value);
    });

    runPublicCaptureScript(targetWindow);
    runPublicCaptureScript(targetWindow);

    expect((targetWindow as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_KEY]).toBe('existing draft');
    expect((targetWindow as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_SELECTION_KEY]).toEqual({
      value: 'existing draft',
      start: 2,
      end: 6,
      direction: 'forward',
    });

    textarea.value = 'typed before hydration';
    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new browserWindow.Event('input', { bubbles: true }));

    const otherTextarea = targetWindow.document.getElementById('other') as HTMLTextAreaElement;
    otherTextarea.value = 'should be ignored';
    otherTextarea.dispatchEvent(new browserWindow.Event('input', { bubbles: true }));

    expect((targetWindow as PromptDraftWindow)[PROMPT_DRAFT_CAPTURE_KEY]).toBe(
      'typed before hydration'
    );
    expect(capturedEvents).toEqual(['typed before hydration']);
  });
});
