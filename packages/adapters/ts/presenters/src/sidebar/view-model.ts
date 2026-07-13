export interface SidebarConversationLike {
  id: number;
  user_input?: string | null;
  result?: string | null;
  projectId?: number | null;
  searchable?: string;
}

export interface LocalConversationLike {
  conversationId: string;
  updatedAt: number | string | Date;
  title?: string | null;
  lastMessagePreview?: string | null;
  projectId?: number | null;
}

export interface SidebarConversationSummary extends SidebarConversationLike {
  timestamp: string;
  model: string;
}

export interface SidebarHighlightPart {
  text: string;
  highlight: boolean;
}

export interface SidebarSearchItem {
  id: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface SidebarSearchIndex {
  initialize(items: SidebarSearchItem[]): void;
  search(query: string): SidebarSearchItem[];
}

class BasicSidebarSearch implements SidebarSearchIndex {
  private items: SidebarSearchItem[] = [];

  initialize(items: SidebarSearchItem[]): void {
    this.items = items.map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      ...(item.tags ? { tags: [...item.tags] } : {}),
    }));
  }

  search(query: string): SidebarSearchItem[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }
    return this.items.filter((item) =>
      [item.title, item.content, ...(item.tags ?? [])].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      )
    );
  }
}

export const normalizeSidebarConversationIdentifier = (value: string | undefined): string => {
  if (!value) {
    return '';
  }
  return value.startsWith('remote-') ? value.slice('remote-'.length) : value;
};

export const createSidebarSearchText = (conversation: {
  title?: string | null;
  lastMessagePreview?: string | null;
  messageContents?: string[];
}): string =>
  [
    conversation.title ?? '',
    conversation.lastMessagePreview ?? '',
    ...(conversation.messageContents ?? []),
  ]
    .filter((part) => part.trim().length > 0)
    .join(' ');

export const compactSidebarTitle = (title: string, maxWords = 5): string => {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(' ');
  }
  return words.slice(0, maxWords).join(' ');
};

const formatSidebarTimestamp = (value: LocalConversationLike['updatedAt']): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isFinite(date.getTime())) {
    return date.toISOString();
  }
  return new Date(0).toISOString();
};

export const mapLocalConversationToSidebarSummary = (
  conversation: LocalConversationLike,
  options: {
    syntheticId: number;
    messageContents?: string[];
    fallbackTitle?: string;
  }
): SidebarConversationSummary => {
  const timestamp = formatSidebarTimestamp(conversation.updatedAt);
  const title = conversation.title || options.fallbackTitle || 'Local conversation';
  const displayTitle = compactSidebarTitle(title);
  const summary: SidebarConversationSummary = {
    id: options.syntheticId,
    timestamp,
    user_input: displayTitle,
    result: conversation.lastMessagePreview ?? '',
    model: conversation.conversationId,
    searchable: createSidebarSearchText({
      title: conversation.title,
      lastMessagePreview: conversation.lastMessagePreview,
      messageContents: options.messageContents,
    }),
  };
  if (conversation.projectId === null || typeof conversation.projectId === 'number') {
    summary.projectId = conversation.projectId;
  }
  return summary;
};

export const dedupeLocalSidebarConversations = <TConversation extends SidebarConversationLike>(
  localConversations: TConversation[],
  remoteConversations: SidebarConversationLike[],
  resolveLocalConversationId: (syntheticId: number) => string | undefined
): TConversation[] => {
  const remoteIds = new Set(remoteConversations.map((conversation) => String(conversation.id)));
  return localConversations.filter((conversation) => {
    const actualId = resolveLocalConversationId(conversation.id);
    return !remoteIds.has(normalizeSidebarConversationIdentifier(actualId));
  });
};

export const filterSidebarConversationsByProject = <TConversation extends SidebarConversationLike>(
  conversations: TConversation[],
  activeProjectId: number | null,
  options: { preserveWhenMissingProjectIds?: boolean } = {}
): TConversation[] => {
  if (activeProjectId === null) {
    return conversations.filter((conversation) => conversation.projectId == null);
  }

  if (
    options.preserveWhenMissingProjectIds &&
    !conversations.some((conversation) => typeof conversation.projectId === 'number')
  ) {
    return conversations;
  }

  return conversations.filter((conversation) => conversation.projectId === activeProjectId);
};

export const filterSidebarConversations = <TConversation extends SidebarConversationLike>(
  conversations: TConversation[],
  query: string,
  search: SidebarSearchIndex = new BasicSidebarSearch()
): TConversation[] => {
  const trimmed = query.trim();
  if (!trimmed) {
    return conversations;
  }
  const searchItems: SidebarSearchItem[] = conversations.map((conversation) => ({
    id: String(conversation.id),
    title: conversation.user_input || '',
    content: conversation.result || '',
    tags: conversation.searchable ? [conversation.searchable] : [],
  }));
  search.initialize(searchItems);
  return search
    .search(trimmed)
    .map((item) => conversations.find((conversation) => String(conversation.id) === item.id))
    .filter((conversation): conversation is TConversation => conversation !== undefined);
};

export const createSidebarSnippet = (text: string, query: string, maxLength = 90): string => {
  if (!text) {
    return '';
  }
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return text.slice(0, maxLength);
  }
  const index = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());
  if (index === -1) {
    return text.slice(0, maxLength);
  }
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + trimmedQuery.length + 50);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
};

export const createSidebarHighlightParts = (
  text: string,
  query: string
): SidebarHighlightPart[] => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [{ text, highlight: false }];
  }
  const escaped = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  const matchRegex = new RegExp(`^${escaped}$`, 'i');
  return parts.map((part) => ({ text: part, highlight: matchRegex.test(part) }));
};
