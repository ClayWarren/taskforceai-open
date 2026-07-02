'use client';

import { type Result, err, ok } from '../result';

export type PlatformError = {
  kind: 'unavailable' | 'failed' | 'invalid';
  message: string;
};

export const scrollToTop = (): void => {
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

/**
 * Navigate to a URL.
 */
export const navigateTo = (url: string): Result<void, PlatformError> => {
  if (!url || !url.trim()) {
    return err({ kind: 'invalid', message: 'URL is required' });
  }

  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Window is not available' });
  }

  try {
    window.location.href = url;
    return ok(undefined);
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Reload the current page.
 */
export const reloadPage = (): Result<void, PlatformError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Window is not available' });
  }

  try {
    window.location.reload();
    return ok(undefined);
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Show a browser alert.
 */
export const showAlert = (message: string): Result<void, PlatformError> => {
  if (typeof window === 'undefined' || typeof window.alert === 'undefined') {
    return err({ kind: 'unavailable', message: 'Alert is not available' });
  }

  try {
    window.alert(message);
    return ok(undefined);
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Show a browser confirm dialog.
 */
export const confirmAction = (message: string): Result<boolean, PlatformError> => {
  if (typeof window === 'undefined' || typeof window.confirm === 'undefined') {
    return err({ kind: 'unavailable', message: 'Confirm is not available' });
  }

  try {
    return ok(window.confirm(message));
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Copy text to clipboard.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * Write text to clipboard (Result-returning version).
 */
export const writeClipboardText = async (text: string): Promise<Result<void, PlatformError>> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return err({ kind: 'unavailable', message: 'Clipboard is not available' });
  }

  try {
    await navigator.clipboard.writeText(text);
    return ok(undefined);
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Trigger a file download from a Blob.
 */
export const downloadBlob = ({
  blob,
  filename,
}: {
  blob: Blob;
  filename: string;
}): Result<void, PlatformError> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return err({ kind: 'unavailable', message: 'Document is not available' });
  }

  try {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
    setTimeout(() => window.URL.revokeObjectURL(url), 0);
    return ok(undefined);
  } catch (error) {
    return err({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
};

export const openInNewTab = (url: string): void => {
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};
