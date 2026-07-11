import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';
import { styles } from './ProjectsScreen.styles';

interface CreateProjectDialogProps {
  isPending: boolean;
  name: string;
  description: string;
  instructions: string;
  onCancel: () => void;
  onChangeDescription: (value: string) => void;
  onChangeInstructions: (value: string) => void;
  onChangeName: (value: string) => void;
  onSubmit: () => void;
  theme: Theme;
}

export function CreateProjectDialog({
  isPending,
  name,
  description,
  instructions,
  onCancel,
  onChangeDescription,
  onChangeInstructions,
  onChangeName,
  onSubmit,
  theme,
}: CreateProjectDialogProps) {
  const canSubmit = Boolean(name.trim()) && !isPending;

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.createModal, { backgroundColor: theme.colors.cardBackground }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Create Project</Text>
          <TouchableOpacity onPress={onCancel}>
            <Icon name="X" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.text }]}
          placeholder="Project name"
          placeholderTextColor={theme.colors.textMuted}
          value={name}
          onChangeText={onChangeName}
          autoFocus
        />

        <TextInput
          style={[
            styles.input,
            styles.textArea,
            { borderColor: theme.colors.border, color: theme.colors.text },
          ]}
          placeholder="Description (optional)"
          placeholderTextColor={theme.colors.textMuted}
          value={description}
          onChangeText={onChangeDescription}
          multiline
          numberOfLines={3}
        />

        <TextInput
          style={[
            styles.input,
            styles.textArea,
            { borderColor: theme.colors.border, color: theme.colors.text },
          ]}
          placeholder="Custom instructions (optional)"
          placeholderTextColor={theme.colors.textMuted}
          value={instructions}
          onChangeText={onChangeInstructions}
          multiline
          numberOfLines={4}
        />

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={[styles.cancelButtonText, { color: theme.colors.textMuted }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: name.trim() ? theme.colors.primary : 'rgba(255,255,255,0.2)' },
            ]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            <Text style={styles.submitButtonText}>{isPending ? 'Creating...' : 'Create'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
