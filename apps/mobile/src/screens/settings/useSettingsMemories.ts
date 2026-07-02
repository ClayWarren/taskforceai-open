import type { Memory } from '@taskforceai/contracts';
import React from 'react';
import { Alert } from 'react-native';

import { getMobileClient } from '../../api/client';
import { createModuleLogger } from '../../logger';

const logger = createModuleLogger('SettingsMemories');
const DEFAULT_MEMORY_TYPE = 'preference';

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface UseSettingsMemoriesOptions {
  t: Translate;
}

export interface SettingsMemoriesState {
  visible: boolean;
  memories: Memory[];
  loading: boolean;
  saving: boolean;
  deletingId: number | null;
  editingMemoryId: number | null;
  draft: string;
  error: string | null;
  open: () => void;
  close: () => void;
  retry: () => void;
  setDraft: (value: string) => void;
  submit: () => Promise<void>;
  edit: (memory: Memory) => void;
  delete: (memory: Memory) => Promise<void>;
  cancelEdit: () => void;
}

const messageFromError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function useSettingsMemories({ t }: UseSettingsMemoriesOptions): SettingsMemoriesState {
  const [visible, setVisible] = React.useState(false);
  const [memories, setMemories] = React.useState<Memory[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [editingMemory, setEditingMemory] = React.useState<Memory | null>(null);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const loadMemories = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextMemories = await getMobileClient().listMemories();
      setMemories(
        nextMemories.toSorted(
          (left, right) =>
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
        )
      );
    } catch (loadError) {
      const message = messageFromError(
        loadError,
        t('mobile.settings.memoryLoadErrorMessage', {
          defaultValue: 'Unable to load memory summary.',
        })
      );
      logger.error('Failed to load memories', { error: loadError });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const open = React.useCallback(() => {
    setVisible(true);
    void loadMemories();
  }, [loadMemories]);

  const close = React.useCallback(() => {
    setVisible(false);
    setDraft('');
    setEditingMemory(null);
  }, []);

  const cancelEdit = React.useCallback(() => {
    setDraft('');
    setEditingMemory(null);
  }, []);

  const submit = React.useCallback(async () => {
    const content = draft.trim();
    if (!content) return;

    setSaving(true);
    try {
      if (editingMemory) {
        const updatedMemory = await getMobileClient().updateMemory(editingMemory.id, {
          content,
          type: editingMemory.type || DEFAULT_MEMORY_TYPE,
        });
        setMemories((current) =>
          current.map((memory) => (memory.id === updatedMemory.id ? updatedMemory : memory))
        );
      } else {
        await getMobileClient().createMemory({
          content,
          type: DEFAULT_MEMORY_TYPE,
        });
        await loadMemories();
      }
      setDraft('');
      setEditingMemory(null);
    } catch (saveError) {
      logger.error('Failed to save memory', { error: saveError, editingId: editingMemory?.id });
      Alert.alert(
        t('mobile.settings.memorySaveErrorTitle', { defaultValue: 'Memory not saved' }),
        t('mobile.settings.memorySaveErrorMessage', {
          defaultValue: 'Unable to save this memory. Please try again.',
        })
      );
    } finally {
      setSaving(false);
    }
  }, [draft, editingMemory, loadMemories, t]);

  const edit = React.useCallback((memory: Memory) => {
    setEditingMemory(memory);
    setDraft(memory.content);
  }, []);

  const deleteMemory = React.useCallback(
    async (memory: Memory) => {
      setDeletingId(memory.id);
      try {
        await getMobileClient().deleteMemory(memory.id);
        setMemories((current) => current.filter((item) => item.id !== memory.id));
        if (editingMemory?.id === memory.id) {
          setDraft('');
          setEditingMemory(null);
        }
      } catch (deleteError) {
        logger.error('Failed to delete memory', { error: deleteError, id: memory.id });
        Alert.alert(
          t('mobile.settings.memoryDeleteErrorTitle', { defaultValue: 'Memory not deleted' }),
          t('mobile.settings.memoryDeleteErrorMessage', {
            defaultValue: 'Unable to delete this memory. Please try again.',
          })
        );
      } finally {
        setDeletingId(null);
      }
    },
    [editingMemory?.id, t]
  );

  return {
    visible,
    memories,
    loading,
    saving,
    deletingId,
    editingMemoryId: editingMemory?.id ?? null,
    draft,
    error,
    open,
    close,
    retry: () => void loadMemories(),
    setDraft,
    submit,
    edit,
    delete: deleteMemory,
    cancelEdit,
  };
}
