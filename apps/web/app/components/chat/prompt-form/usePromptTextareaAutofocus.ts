import { useEffect } from 'react';

interface UsePromptTextareaAutofocusOptions {
  controlsDisabled: boolean;
  interactionsDisabled: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function usePromptTextareaAutofocus({
  controlsDisabled,
  interactionsDisabled,
  textareaRef,
}: UsePromptTextareaAutofocusOptions) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const userAgent = window.navigator?.userAgent ?? '';
    const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent);

    if (isMobileDevice || interactionsDisabled || controlsDisabled) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const target = textareaRef.current;
      if (!target) {
        return;
      }

      if (document.activeElement !== target) {
        target.focus({ preventScroll: true });
      }
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [interactionsDisabled, controlsDisabled, textareaRef]);
}
