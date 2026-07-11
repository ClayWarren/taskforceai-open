import { FlashList } from '@shopify/flash-list';
import React, { useCallback } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';

import type { ConversationSummary, Project } from '@taskforceai/contracts/contracts';
import { createSidebarHighlightParts, createSidebarSnippet } from '@taskforceai/presenters';
import { styled } from '../utils/nativewind';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { SidebarProjects } from './sidebar/SidebarProjects';

const StyledFlashList = styled(FlashList) as any;
const StyledView = styled(View);

// ── Search highlight helpers ──────────────────────────────────────────────────

const HighlightedText = ({
  text,
  query,
  style,
  highlightStyle,
  numberOfLines,
}: {
  text: string;
  query: string;
  style: object;
  highlightStyle: object;
  numberOfLines?: number;
}) => {
  const parts = createSidebarHighlightParts(text, query);
  return (
    <Text style={style} numberOfLines={numberOfLines ?? 1}>
      {parts.map((part, i) =>
        part.highlight ? (
          <Text key={i} style={highlightStyle}>{part.text}</Text>
        ) : (
          <Text key={i}>{part.text}</Text>
        )
      )}
    </Text>
  );
};

type SidebarConversation = ConversationSummary & { searchable?: string };

type SidebarViewProps = {
  visible: boolean;
  onClose: () => void;
  onNewChat: () => void;
  isAuthenticated: boolean;
  insets: EdgeInsets;
  SidebarComponent: React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>;
  useGlass: boolean;
  searchQuery: string;
  setSearchQuery: (next: string) => void;
  projects: Project[];
  activeProjectId: number | null;
  onSelectProject: (projectId: number | null) => void;
  onManageProjects: () => void;
  filteredConversations: SidebarConversation[];
  handleConversationPress: (conversationId: number) => void;
  handleDeleteConversation: (conversationId: number, title?: string) => void;
  userName?: string;
  userInitials?: string;
  onSettingsPress?: () => void;
  onEndReached?: () => void;
  isLoadingMore?: boolean;
  desktopSessionsSlot?: React.ReactNode;
};

export function SidebarView({
  visible,
  onClose,
  onNewChat,
  isAuthenticated,
  insets,
  SidebarComponent,
  useGlass,
  searchQuery,
  setSearchQuery,
  projects,
  activeProjectId,
  onSelectProject,
  onManageProjects,
  filteredConversations,
  handleConversationPress,
  handleDeleteConversation,
  userName,
  userInitials,
  onSettingsPress,
  onEndReached,
  isLoadingMore,
  desktopSessionsSlot,
}: SidebarViewProps) {
  const { t } = useTranslation();

  const handleNewChat = () => {
    onNewChat();
    onClose();
  };

  const renderEmptyState = useCallback(() => {
    if (!isAuthenticated) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('sidebar.guestMode', 'Guest mode')}</Text>
          <Text style={styles.emptySubtitle}>
            {t(
              'sidebar.guestModeDescription',
              'Local prompt drafts stay on this device. Sign in to run AI tasks and sync conversations.'
            )}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>
          {searchQuery
            ? t('sidebar.noConversationsFoundSearch', 'No conversations found')
            : t('sidebar.noConversationsYet', 'No conversations yet')}
        </Text>
        <Text style={styles.emptySubtitle}>
          {searchQuery
            ? t('sidebar.tryDifferentSearch', 'Try a different search')
            : t('sidebar.startNewChatPrompt', 'Start a new chat to begin')}
        </Text>
      </View>
    );
  }, [isAuthenticated, searchQuery, t]);

  const renderConversationItem = ({ item }: { item: SidebarConversation }) => {
    const title = item.user_input || t('sidebar.untitledConversation', 'Untitled conversation');
    const snippet = createSidebarSnippet(item.result || '', searchQuery);
    const showSnippet = !!searchQuery.trim() && !!snippet;

    return (
      <TouchableOpacity
        onPress={() => handleConversationPress(item.id)}
        onLongPress={() => handleDeleteConversation(item.id, item.user_input || item.result)}
        activeOpacity={0.6}
        style={styles.conversationRow}
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityHint="Open conversation. Long press for archive and delete actions."
      >
        <HighlightedText
          text={title}
          query={searchQuery}
          style={styles.conversationTitle}
          highlightStyle={styles.conversationTitleHighlight}
          numberOfLines={1}
        />
        {showSnippet && (
          <HighlightedText
            text={snippet}
            query={searchQuery}
            style={styles.conversationSnippet}
            highlightStyle={styles.conversationSnippetHighlight}
            numberOfLines={2}
          />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <StyledView className="flex-1 flex-row" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
        {/* Backdrop tap to dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close sidebar"
          accessibilityRole="button"
        />

        {/* Panel */}
        <View style={{ height: '100%', width: '80%', maxWidth: 320 }}>
          <SidebarComponent
            className="h-full border-r border-white/10"
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(26, 26, 26, 0.96)',
              shadowColor: '#000',
              shadowOffset: { width: 2, height: 0 },
              shadowOpacity: 0.5,
              shadowRadius: 8,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            }}
            {...(useGlass ? { glassEffectStyle: 'regular', tintColor: '#1a1a1a' } : {})}
          >
            <SidebarHeader
              SidebarComponent={SidebarComponent}
              useGlass={useGlass}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onNewChat={handleNewChat}
              searchLabel={t('sidebar.searchConversations', 'Search conversations')}
              newChatLabel={t('sidebar.startNewChat', 'New chat')}
            />

            {isAuthenticated ? (
              <SidebarProjects
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={onSelectProject}
                onManageProjects={onManageProjects}
                labels={{
                  projects: t('sidebar.projects', 'Projects'),
                  general: t('sidebar.general', 'General'),
                  generalProject: t('sidebar.generalProject', 'General project'),
                  manageProjects: t('sidebar.manageProjects', 'Manage projects'),
                }}
              />
            ) : null}

            {desktopSessionsSlot ? (
              <View style={styles.desktopSessionsSlot}>{desktopSessionsSlot}</View>
            ) : null}

            {/* ── Conversations ── */}
            <StyledFlashList
              data={filteredConversations}
              keyExtractor={(item: SidebarConversation) => item.id.toString()}
              renderItem={renderConversationItem}
              className="flex-1"
              contentContainerStyle={
                filteredConversations.length === 0
                  ? { flexGrow: 1, justifyContent: 'center' }
                  : { paddingTop: 4 }
              }
              ListEmptyComponent={renderEmptyState}
              estimatedItemSize={searchQuery.trim() ? 62 : 44}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isLoadingMore ? (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(148,163,184,0.6)', fontSize: 12 }}>
                      Loading more...
                    </Text>
                  </View>
                ) : null
              }
            />

            <SidebarFooter
              isAuthenticated={isAuthenticated}
              userName={userName}
              userInitials={userInitials}
              onSettingsPress={onSettingsPress}
            />
          </SidebarComponent>
        </View>
      </StyledView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  conversationRow: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  conversationTitle: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 20,
  },
  conversationTitleHighlight: {
    fontWeight: '700',
    color: '#ffffff',
  },
  conversationSnippet: {
    fontSize: 12,
    color: 'rgba(148,163,184,0.65)',
    lineHeight: 17,
    marginTop: 2,
  },
  conversationSnippetHighlight: {
    fontWeight: '600',
    color: '#94a3b8',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: 'rgba(148,163,184,0.7)',
    textAlign: 'center',
  },
  desktopSessionsSlot: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
});
