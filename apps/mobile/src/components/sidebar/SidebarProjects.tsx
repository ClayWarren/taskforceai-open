import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Project } from '@taskforceai/contracts/contracts';
import { styled } from '../../utils/nativewind';
import { Icon } from '../Icon';

const StyledView = styled(View);

interface SidebarProjectsProps {
  projects: Project[];
  activeProjectId: number | null;
  onSelectProject: (_projectId: number | null) => void;
  onManageProjects: () => void;
  labels: {
    projects: string;
    general: string;
    generalProject: string;
    manageProjects: string;
  };
}

export function SidebarProjects({
  projects,
  activeProjectId,
  onSelectProject,
  onManageProjects,
  labels,
}: SidebarProjectsProps) {
  return (
    <StyledView style={styles.projectsSection}>
      <Text style={styles.sectionLabel}>{labels.projects}</Text>
      <TouchableOpacity
        onPress={() => onSelectProject(null)}
        style={[styles.projectRow, activeProjectId === null && styles.projectRowActive]}
        accessibilityRole="button"
        accessibilityLabel={labels.generalProject}
      >
        <Text style={styles.projectEmoji}>🌐</Text>
        <Text
          style={[
            styles.projectName,
            activeProjectId === null ? styles.projectNameActive : styles.projectNameMuted,
          ]}
        >
          {labels.general}
        </Text>
      </TouchableOpacity>
      {projects.map((project) => {
        const isActive = activeProjectId === project.id;
        return (
          <TouchableOpacity
            key={project.id}
            onPress={() => onSelectProject(project.id)}
            style={[styles.projectRow, isActive && styles.projectRowActive]}
            accessibilityRole="button"
            accessibilityLabel={`Project ${project.name}`}
          >
            <Text style={styles.projectEmoji}>📁</Text>
            <Text
              style={[styles.projectName, isActive ? styles.projectNameActive : styles.projectNameMuted]}
              numberOfLines={1}
            >
              {project.name}
            </Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        onPress={onManageProjects}
        style={styles.manageProjectsBtn}
        accessibilityRole="button"
        accessibilityLabel={labels.manageProjects}
      >
        <Icon name="Plus" size={14} color="rgba(148,163,184,0.6)" strokeWidth={2} />
        <Text style={styles.manageProjectsText}>{labels.manageProjects}</Text>
      </TouchableOpacity>
    </StyledView>
  );
}

const styles = StyleSheet.create({
  projectsSection: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(148,163,184,0.6)',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    marginBottom: 2,
  },
  projectRowActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  projectEmoji: {
    fontSize: 15,
  },
  projectName: {
    flex: 1,
    fontSize: 14,
  },
  projectNameActive: {
    color: '#e2e8f0',
  },
  projectNameMuted: {
    color: 'rgba(148,163,184,0.7)',
  },
  manageProjectsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 2,
  },
  manageProjectsText: {
    fontSize: 13,
    color: 'rgba(148,163,184,0.6)',
  },
});
