'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import React from 'react';

import MessageBubble from '../../components/chat/MessageBubble';
import RateLimitError from '../../components/chat/RateLimitError';
import type { Message } from '../../lib/types';
import { MobileHero } from './MobileHero';

interface ChatViewProps {
  messages: Message[];
  showMobileHero: boolean;
  showPromptLogo: boolean;
  promptVariant: 'centered' | 'bottom';
  isPromptDisabled: boolean;
  isAuthenticated: boolean;
  errorMessage: string | null;
  rateLimitResetTime: string | null;
  modelSelectorBootstrap: ModelSelectorResponse | null;
  onHamburgerClick: () => void;
  onSignIn: () => void;
  onSendMessage: (_content: string) => void;
  clearErrorMessage: () => void;
  ensureConversationId: () => Promise<string>;
  canShare?: boolean;
  onShare?: () => void;
  isPrivateChat?: boolean;
  hasMoreMessages?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  executionPresentation?: 'standard' | 'code';
  onRestoreMessage?: (_message: Message) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  showMobileHero,
  isAuthenticated,
  errorMessage,
  rateLimitResetTime,
  onHamburgerClick,
  onSignIn,
  clearErrorMessage,
  canShare,
  onShare,
  isPrivateChat = false,
  hasMoreMessages,
  isLoadingMore,
  onLoadMore,
  executionPresentation = 'standard',
  onRestoreMessage,
}) => (
  <>
    <div className={`chat-messages ${showMobileHero ? 'chat-messages--hero' : ''}`}>
      {showMobileHero ? (
        <MobileHero
          isAuthenticated={isAuthenticated}
          onHamburgerClick={onHamburgerClick}
          onSignIn={onSignIn}
        />
      ) : null}
      {messages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isUser={msg.role === 'user'}
          canShare={canShare}
          onShare={onShare}
          isPrivateChat={isPrivateChat}
          isLatestMessage={index === messages.length - 1}
          executionPresentation={executionPresentation}
          onRestore={onRestoreMessage}
        />
      ))}
      {hasMoreMessages && (
        <div className="chat-aligned chat-edge-left mb-6">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {isLoadingMore ? 'Loading older messages...' : 'Load more messages'}
          </button>
        </div>
      )}
      {errorMessage ? (
        errorMessage.toLowerCase().includes('rate limit') ||
        errorMessage.toLowerCase().includes('message limit') ? (
          <RateLimitError
            message={errorMessage}
            {...(rateLimitResetTime ? { resetTime: rateLimitResetTime } : {})}
            onDismiss={clearErrorMessage}
          />
        ) : (
          <div className="error-message chat-aligned chat-edge-left mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-500 dark:border-red-800 dark:bg-red-900/20">
            <button
              onClick={clearErrorMessage}
              className="float-right text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Dismiss error"
            >
              ✕
            </button>
            {errorMessage}
          </div>
        )
      ) : null}
    </div>
  </>
);
