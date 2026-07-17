import { FlashList } from '@shopify/flash-list';
import type { Project } from '@taskforceai/contracts/contracts';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';
import { styles } from './ProjectsScreen.styles';

type ProjectsFlashListProps = {
  data: readonly Project[];
  keyExtractor: (item: Project) => string;
  renderItem: (info: { item: Project; index: number }) => React.ReactElement | null;
  contentContainerStyle?: typeof styles.listContent | typeof styles.emptyListContent;
  estimatedItemSize?: number;
  ListEmptyComponent?: React.ReactElement | null;
};

const ProjectsFlashList = FlashList as React.ComponentType<ProjectsFlashListProps>;

interface ProjectsListProps {
  activeProjectId: number | null;
  deletePending: boolean;
  onDeleteProject: (project: Project) => void;
  onCreateProject: () => void;
  onSelectProject: (projectId: number | null) => void;
  projects: Project[];
  showFirstProjectEmptyState: boolean;
  theme: Theme;
}

export function ProjectsList({
  activeProjectId,
  deletePending,
  onDeleteProject,
  onCreateProject,
  onSelectProject,
  projects,
  showFirstProjectEmptyState,
  theme,
}: ProjectsListProps) {
  const renderProject = ({ item }: { item: Project }) => {
    const isActive = activeProjectId === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.projectItem,
          {
            borderColor: isActive ? theme.colors.primary : theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
        ]}
        onPress={() => onSelectProject(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.projectInfo}>
          <Text style={[styles.projectName, { color: theme.colors.text }]}>{item.name}</Text>
          {item.description ? (
            <Text
              style={[styles.projectDescription, { color: theme.colors.textMuted }]}
              numberOfLines={2}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        <View style={styles.projectActions}>
          {isActive ? (
            <Icon name="ArrowUpRight" size={16} color={theme.colors.primary} />
          ) : null}
          <TouchableOpacity
            onPress={() => onDeleteProject(item)}
            disabled={deletePending}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="Trash2" size={16} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ProjectsFlashList
      data={projects}
      keyExtractor={(item) => item.id.toString()}
      renderItem={renderProject}
      contentContainerStyle={
        projects.length === 0 ? styles.emptyListContent : styles.listContent
      }
      estimatedItemSize={80}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          {showFirstProjectEmptyState ? (
            <>
              <View style={[styles.emptyIcon, { backgroundColor: theme.colors.cardBackground }]}>
                <Icon name="Folder" size={22} color={theme.colors.text} />
              </View>
              <Text style={[styles.emptyText, { color: theme.colors.text }]}>Start your first project</Text>
              <Text style={[styles.emptySubtext, { color: theme.colors.textMuted }]}>Projects help you organize chats, files, and tools in one place</Text>
              <TouchableOpacity
                onPress={onCreateProject}
                style={[styles.emptyCreateButton, { backgroundColor: theme.colors.text }]}
                accessibilityRole="button"
                accessibilityLabel="Create your first project"
              >
                <Text style={[styles.emptyCreateButtonText, { color: theme.colors.background }]}>New project</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[styles.emptyText, { color: theme.colors.text }]}>No projects found</Text>
              <Text style={[styles.emptySubtext, { color: theme.colors.textMuted }]}>Try a different search</Text>
            </>
          )}
        </View>
      }
    />
  );
}
