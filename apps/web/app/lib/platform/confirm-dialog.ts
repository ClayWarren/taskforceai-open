'use client';

import { logger } from '../logger';
import {
  BUTTON_CONTAINER_STYLES,
  CANCEL_BUTTON_STYLES,
  CONFIRM_BUTTON_STYLES,
  DIALOG_STYLES,
  MESSAGE_STYLES,
  MODAL_STYLES,
  TITLE_STYLES,
  WARNING_CONFIRM_BUTTON_STYLES,
} from './confirm-dialog-styles';

export const confirmDialog = async (
  message: string,
  options?: { title?: string; kind?: string; confirmLabel?: string; cancelLabel?: string }
): Promise<boolean> => {
  logger.debug('confirmDialog invoked', { message, options });

  return new Promise<boolean>((resolve) => {
    const dialogId = `confirm-dialog-title-${Date.now()}`;
    const messageId = `confirm-dialog-message-${Date.now()}`;
    const modal = document.createElement('div');
    modal.style.cssText = MODAL_STYLES;

    const dialog = document.createElement('div');
    dialog.style.cssText = DIALOG_STYLES;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', dialogId);
    dialog.setAttribute('aria-describedby', messageId);

    const title = document.createElement('h3');
    title.id = dialogId;
    title.textContent = options?.title || 'Confirm';
    title.style.cssText = TITLE_STYLES;

    const messageEl = document.createElement('p');
    messageEl.id = messageId;
    messageEl.textContent = message;
    messageEl.style.cssText = MESSAGE_STYLES;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = BUTTON_CONTAINER_STYLES;

    const cancelButton = document.createElement('button');
    cancelButton.textContent = options?.cancelLabel || 'Cancel';
    cancelButton.style.cssText = CANCEL_BUTTON_STYLES;

    const confirmButton = document.createElement('button');
    confirmButton.textContent =
      options?.confirmLabel || (options?.kind === 'warning' ? 'Delete' : 'Confirm');
    confirmButton.style.cssText =
      options?.kind === 'warning' ? WARNING_CONFIRM_BUTTON_STYLES : CONFIRM_BUTTON_STYLES;

    let finished = false;
    const handleCancelClick = () => handleClick(false);
    const handleConfirmClick = () => handleClick(true);
    const handleClick = (result: boolean) => {
      if (finished) return;
      finished = true;
      cancelButton.removeEventListener('click', handleCancelClick);
      confirmButton.removeEventListener('click', handleConfirmClick);
      document.removeEventListener('keydown', handleKeydown);
      modal.removeEventListener('click', handleBackdropClick);
      if (modal.parentNode === document.body) {
        document.body.removeChild(modal);
      }
      logger.debug('confirmDialog result', { result });
      resolve(result);
    };

    cancelButton.addEventListener('click', handleCancelClick);
    confirmButton.addEventListener('click', handleConfirmClick);

    // Handle escape key
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClick(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = [cancelButton, confirmButton];
        const activeElement = document.activeElement;
        const currentIndex = focusable.indexOf(activeElement as HTMLButtonElement);
        const direction = e.shiftKey ? -1 : 1;
        let nextIndex = currentIndex + direction;
        if (nextIndex < 0) {
          nextIndex = focusable.length - 1;
        } else if (nextIndex >= focusable.length) {
          nextIndex = 0;
        }
        e.preventDefault();
        focusable[nextIndex]?.focus();
      }
    }
    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target === modal) {
        handleClick(false);
      }
    };
    document.addEventListener('keydown', handleKeydown);
    modal.addEventListener('click', handleBackdropClick);

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(confirmButton);
    dialog.appendChild(title);
    dialog.appendChild(messageEl);
    dialog.appendChild(buttonContainer);
    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // Focus the confirm button by default
    requestAnimationFrame(() => {
      confirmButton.focus();
    });
  });
};
