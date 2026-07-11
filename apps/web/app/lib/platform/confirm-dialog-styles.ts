'use client';

// Modal overlay styles
export const MODAL_STYLES = `
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999999;
  font-family: system-ui, -apple-system, sans-serif;
`;

// Dialog container styles
export const DIALOG_STYLES = `
  background: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  max-width: 400px;
  width: 90%;
`;

// Title styles
export const TITLE_STYLES = `
  margin: 0 0 16px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
`;

// Message styles
export const MESSAGE_STYLES = `
  margin: 0 0 24px 0;
  line-height: 1.5;
  color: #4b5563;
`;

// Button container styles
export const BUTTON_CONTAINER_STYLES = `
  display: flex;
  gap: 12px;
  justify-content: flex-end;
`;

// Cancel button styles
export const CANCEL_BUTTON_STYLES = `
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
`;

// Confirm button styles
export const CONFIRM_BUTTON_STYLES = `
  padding: 8px 16px;
  border: none;
  background: #2563eb;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
`;

export const WARNING_CONFIRM_BUTTON_STYLES = `
  padding: 8px 16px;
  border: none;
  background: #dc2626;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
`;
