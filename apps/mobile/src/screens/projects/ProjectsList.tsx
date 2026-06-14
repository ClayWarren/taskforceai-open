import { FlashList } from '@shopify/flash-list';
import type { Project } from '@taskforceai/contracts/contracts';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';
import { styles } from './ProjectsScreen.styles';

type FlashListPropsWithEstimatedSize<T> = React.ComponentProps<typeof FlashList<T>> & {
  estimatedItemSize?: number;
};

const ProjectsFlashList = FlashList as React.ComponentType<FlashListPropsWithEstimatedSize<Project>>;

interface ProjectsListProps {
  activeProjectId: number | null;
  deletePending: boolean;
  onDeleteProject: (project: Project) => void;
  onSelectProject: (projectId: number | null) => void;
  projects: Project[];
  theme: Theme;
}

export function ProjectsList({
  activeProjectId,
  deletePending,
  onDeleteProject,
  onSelectProject,
  projects,
  theme,
}: ProjectsListProps) {
  const renderProject = ({ item }: { item: Project }) => {
    const isActive = activeProjectId === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.projectItem,
          { borderColor: isActive ? theme.colors.primary : 'rgba(255,255,255,0.1)' },
        ]}
        onPress={() => onSelectProject(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.projectInfo}>
          <Text style={styles.projectName}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.projectDescription} numberOfLines={2}>
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
            <Icon name="Trash2" size={16} color="rgba(255,255,255,0.5)" />
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
      contentContainerStyle={styles.listContent}
      estimatedItemSize={80}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No projects yet</Text>
          <Text style={styles.emptySubtext}>Create a project to organize your conversations</Text>
        </View>
      }
    />
  );
}
