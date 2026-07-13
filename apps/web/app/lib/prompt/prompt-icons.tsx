'use client';

import type { ReactNode } from 'react';

interface PromptIconProps {
  children: ReactNode;
  className?: string;
  stroke?: 'white' | 'currentColor';
}

const PromptIcon = ({ children, className = '', stroke = 'white' }: PromptIconProps) => (
  <svg
    className={className}
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={stroke}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const AttachFileIcon = () => (
  <PromptIcon>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </PromptIcon>
);

export const VoiceIcon = () => (
  <PromptIcon>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10a7 7 0 0 1-14 0" />
    <path d="M12 19v4" />
    <path d="M8 23h8" />
  </PromptIcon>
);

export const EllipsisIcon = () => (
  <PromptIcon>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </PromptIcon>
);

export const PulseIcon = () => (
  <PromptIcon>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </PromptIcon>
);

export const MonitorIcon = ({ className = '' }: { className?: string }) => (
  <PromptIcon className={className} stroke="currentColor">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </PromptIcon>
);

export const MaximizeIcon = ({ className = '' }: { className?: string }) => (
  <PromptIcon className={className} stroke="currentColor">
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </PromptIcon>
);

export const MinimizeIcon = ({ className = '' }: { className?: string }) => (
  <PromptIcon className={className} stroke="currentColor">
    <path d="M4 14h6v6" />
    <path d="M20 10h-6V4" />
    <path d="M14 10l7-7" />
    <path d="M10 14l-7 7" />
  </PromptIcon>
);

export const ActivityIcon = ({ className = '' }: { className?: string }) => (
  <PromptIcon className={className} stroke="currentColor">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </PromptIcon>
);
