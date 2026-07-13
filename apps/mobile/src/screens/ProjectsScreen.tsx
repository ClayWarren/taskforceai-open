import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../contexts/ThemeContext';
import { useCreateProjectMutation, useDeleteProjectMutation } from '../hooks/api/projects';
import { Icon } from '../components/Icon';
import { createModuleLogger } from '../logger';
import type { Project } from '@taskforceai/contracts/contracts';
import { CreateProjectDialog } from './projects/CreateProjectDialog';
import { ProjectsList } from './projects/ProjectsList';
import { styles } from './projects/ProjectsScreen.styles';

interface ProjectsScreenProps {
  visible: boolean;
  onClose: () => void;
  projects: Project[];
  activeProjectId: number | null;
  onSelectProject: (projectId: number | null) => void;
}

const logger = createModuleLogger('ProjectsScreen');

export function ProjectsScreen({
  visible,
  onClose,
  projects,
  activeProjectId,
  onSelectProject,
}: ProjectsScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectInstructions, setNewProjectInstructions] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const createProject = useCreateProjectMutation();
  const deleteProject = useDeleteProjectMutation();
  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      [project.name, project.description, project.custom_instructions]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [projects, searchQuery]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      const request = {
        name: newProjectName.trim(),
        ...(newProjectDescription.trim() ? { description: newProjectDescription.trim() } : {}),
        ...(newProjectInstructions.trim()
          ? { custom_instructions: newProjectInstructions.trim() }
          : {}),
      };
      await createProject.mutateAsync(request);
      setNewProjectName('');
      setNewProjectDescription('');
      setNewProjectInstructions('');
      setIsCreating(false);
    } catch (error) {
      logger.error('Failed to create project', { error });
      Alert.alert('Error', 'Failed to create project');
    }
  };

  const handleDeleteProject = (project: Project) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteProject.mutateAsync(project.id);
                if (activeProjectId === project.id) {
                  onSelectProject(null);
                }
              } catch (error) {
                logger.error('Failed to delete project', { error, projectId: project.id });
                Alert.alert('Error', 'Failed to delete project');
              }
            })();
          },
        },
      ]
    );
  };

  const handleCreateProjectPress = () => {
    void handleCreateProject();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.background,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
          >
            <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.text }]}>Projects</Text>
          <TouchableOpacity
            onPress={() => setIsCreating(true)}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Create project"
          >
            <Icon name="Plus" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <ProjectsList
          activeProjectId={activeProjectId}
          deletePending={deleteProject.isPending}
          onDeleteProject={handleDeleteProject}
          onCreateProject={() => setIsCreating(true)}
          onSelectProject={onSelectProject}
          projects={filteredProjects}
          showFirstProjectEmptyState={projects.length === 0}
          theme={theme}
        />

        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.colors.cardBackground,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Icon name="Search" size={20} color={theme.colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search projects"
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.searchInput, { color: theme.colors.text }]}
            accessibilityLabel="Search projects"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear project search"
            >
              <Icon name="X" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {isCreating && (
          <CreateProjectDialog
            description={newProjectDescription}
            instructions={newProjectInstructions}
            isPending={createProject.isPending}
            name={newProjectName}
            onCancel={() => setIsCreating(false)}
            onChangeDescription={setNewProjectDescription}
            onChangeInstructions={setNewProjectInstructions}
            onChangeName={setNewProjectName}
            onSubmit={handleCreateProjectPress}
            theme={theme}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
