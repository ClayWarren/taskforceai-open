'use client';

import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { compactSidebarTitle } from '@taskforceai/presenters/sidebar/view-model';
import clsx from 'clsx';
import React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit/dropdown-menu';
import {
  conversationActivityPresentation,
  resolveConversationActivity,
  type ConversationActivity,
} from './conversation-activity';

interface ConversationItemProps {
  conversation: ConversationSummary;
  onClick: (_id: number) => void;
  onArchive?: (_id: number) => void;
  onDelete: (_id: number) => void;
  onPinToggle?: (_id: number) => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (_value: string) => void;
  onEditSubmit?: () => void;
  onEditCancel?: () => void;
  onRenameRequest?: (_id: number) => void;
  hasUnread?: boolean;
  activeActivity?: ConversationActivity | null;
  isActive?: boolean;
  isPinned?: boolean;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  onClick,
  onArchive,
  onDelete,
  onPinToggle,
  isEditing = false,
  editValue,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onRenameRequest,
  hasUnread = false,
  activeActivity = null,
  isActive = false,
  isPinned = false,
}) => {
  const resolvedEditValue = editValue ?? '';
  const canSubmitEdit = resolvedEditValue.trim().length > 0;
  const displayTitle = compactSidebarTitle(conversation.user_input);
  const activity = resolveConversationActivity({
    conversation,
    activeActivity,
    hasUnread,
    isActive,
  });
  const activityPresentation = activity ? conversationActivityPresentation[activity] : null;
  const handleClick = () => {
    onClick(conversation.id);
  };

  if (isEditing) {
    return (
      <form
        className="conversation-item conversation-item--editing group relative flex w-full items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmitEdit) {
            return;
          }
          onEditSubmit?.();
        }}
      >
        <input
          autoFocus
          className="conversation-rename-input"
          value={resolvedEditValue}
          onChange={(event) => onEditChange?.(event.target.value)}
          placeholder="Conversation title"
        />
        <div className="conversation-rename-actions">
          <button type="submit" disabled={!canSubmitEdit}>
            Save
          </button>
          <button type="button" onClick={onEditCancel}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      className={clsx(
        'conversation-item group relative flex w-full items-center gap-2 transition-colors duration-200 hover:bg-[var(--hover-bg)]',
        isActive && 'conversation-item--active'
      )}
    >
      <button
        type="button"
        className="conversation-line flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent p-0 text-left"
        onClick={handleClick}
        aria-label={`Conversation: ${conversation.user_input}`}
        aria-current={isActive ? 'page' : undefined}
        title={conversation.user_input}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {activityPresentation ? (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${activityPresentation.dotClassName}`}
            aria-label={activityPresentation.label}
            title={activityPresentation.label}
          />
        ) : null}
        <span className="input overflow-hidden text-sm text-ellipsis whitespace-nowrap text-[var(--text-color)]">
          {displayTitle}
        </span>
      </button>
      <div className="conversation-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Conversation actions"
              className="conversation-actions__trigger"
              onClick={(event) => event.stopPropagation()}
            >
              ⋯
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            sideOffset={8}
            className="conversation-actions__dropdown"
          >
            <DropdownMenuItem
              className="conversation-actions__dropdown-item"
              onSelect={(event) => {
                event.stopPropagation();
                onPinToggle?.(conversation.id);
              }}
            >
              {isPinned ? 'Unpin Chat' : 'Pin Chat'}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="conversation-actions__dropdown-item"
              onSelect={(event) => {
                event.stopPropagation();
                onRenameRequest?.(conversation.id);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="conversation-actions__dropdown-item"
              onSelect={(event) => {
                event.stopPropagation();
                onArchive?.(conversation.id);
              }}
            >
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              className="conversation-actions__dropdown-item"
              onSelect={(event) => {
                event.stopPropagation();
                onDelete(conversation.id);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default ConversationItem;
