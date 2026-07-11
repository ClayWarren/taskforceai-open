import { spacingTokens } from '@taskforceai/design-tokens';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
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

  const createProject = useCreateProjectMutation();
  const deleteProject = useDeleteProjectMutation();

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
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacingTokens.md }]}>
          <Text style={styles.title}>Projects</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="X" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => setIsCreating(true)}
        >
          <Icon name="Plus" size={20} color="#ffffff" />
          <Text style={styles.createButtonText}>Create New Project</Text>
        </TouchableOpacity>

        <ProjectsList
          activeProjectId={activeProjectId}
          deletePending={deleteProject.isPending}
          onDeleteProject={handleDeleteProject}
          onSelectProject={onSelectProject}
          projects={projects}
          theme={theme}
        />

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
