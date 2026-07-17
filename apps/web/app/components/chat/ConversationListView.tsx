import type { ConversationSummary } from '@taskforceai/contracts/contracts';

import ConversationItem from './ConversationItem';
import type { ConversationActivity } from './conversation-activity';

interface ConversationListViewProps {
  activeSearchQuery: string;
  editingId: number | null;
  editingValue: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  isInitialLoading: boolean;
  listToRender: ConversationSummary[];
  onArchiveConversation: (id: number) => Promise<void> | void;
  onConversationClick: (id: number) => void;
  onDeleteConversation: (id: number) => Promise<void> | void;
  onEditCancel: () => void;
  onEditChange: (value: string) => void;
  onEditSubmit: () => Promise<void> | void;
  onLoadMore: () => void;
  onPinConversation: (id: number) => void;
  onRenameRequest: (id: number) => void;
  onSearchChange: (value: string) => void;
  searchQuery: string;
  showSearch: boolean;
  unreadIds: Set<string>;
  pinnedConversationIds: ReadonlySet<string>;
  getActualConversationId: (id: number) => string | undefined;
  activeConversationId?: string | null;
  activeConversationActivity?: ConversationActivity | null;
}

export function ConversationListView({
  activeSearchQuery,
  editingId,
  editingValue,
  hasMore,
  isLoadingMore,
  isInitialLoading,
  listToRender,
  onArchiveConversation,
  onConversationClick,
  onDeleteConversation,
  onEditCancel,
  onEditChange,
  onEditSubmit,
  onLoadMore,
  onPinConversation,
  onRenameRequest,
  onSearchChange,
  searchQuery,
  showSearch,
  unreadIds,
  pinnedConversationIds,
  getActualConversationId,
  activeConversationId,
  activeConversationActivity,
}: ConversationListViewProps) {
  return (
    <nav className="conversations" aria-label="Conversation history">
      {showSearch ? (
        <div className="conversation-search">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search conversations"
            className="conversation-search__input"
          />
        </div>
      ) : null}
      {isInitialLoading ? (
        <div className="empty-state" role="status">
          Loading conversations...
        </div>
      ) : listToRender.length === 0 ? (
        <div className="empty-state" role="status">
          No conversations yet
        </div>
      ) : (
        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {listToRender.map((conversation) => {
            const actualId = getActualConversationId(conversation.id);
            const isActive = Boolean(actualId && actualId === activeConversationId);

            return (
              <li key={conversation.id}>
                <ConversationItem
                  conversation={conversation}
                  onArchive={(id) => {
                    void onArchiveConversation(id);
                  }}
                  onClick={onConversationClick}
                  onDelete={(id) => {
                    void onDeleteConversation(id);
                  }}
                  onPinToggle={onPinConversation}
                  isEditing={editingId === conversation.id}
                  editValue={editingId === conversation.id ? editingValue : ''}
                  onEditChange={onEditChange}
                  onEditSubmit={() => {
                    void onEditSubmit();
                  }}
                  onEditCancel={onEditCancel}
                  onRenameRequest={onRenameRequest}
                  hasUnread={actualId ? unreadIds.has(actualId) : false}
                  activeActivity={isActive ? activeConversationActivity : null}
                  isActive={isActive}
                  isPinned={Boolean(actualId && pinnedConversationIds.has(actualId))}
                />
              </li>
            );
          })}
          {hasMore && !activeSearchQuery.trim() ? (
            <li className="p-2">
              <button
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="w-full rounded-lg bg-gray-100 p-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {isLoadingMore ? 'Loading...' : 'Load more'}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </nav>
  );
}
