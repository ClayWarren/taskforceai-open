import React from 'react';

import { ActionButton } from '../../components/ActionButton';
import { Section as SettingsSection } from './components';

interface DataAccountActionsProps {
  title: string;
  exportLabel: string;
  deleteLabel: string;
  logoutLabel: string;
  isLoading: boolean;
  onExport: () => void;
  onDelete: () => void;
  onLogout: () => void;
}

export function DataAccountActions({
  title,
  exportLabel,
  deleteLabel,
  logoutLabel,
  isLoading,
  onExport,
  onDelete,
  onLogout,
}: DataAccountActionsProps) {
  return (
    <SettingsSection title={title}>
      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        disabled={isLoading}
        isLoading={isLoading}
        onPress={onExport}
      >
        {exportLabel}
      </ActionButton>
      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        variant="danger"
        disabled={isLoading}
        onPress={onDelete}
      >
        {deleteLabel}
      </ActionButton>
      <ActionButton
        size="large"
        style={{ marginHorizontal: 16, marginVertical: 10 }}
        className="mb-0"
        variant="danger"
        onPress={onLogout}
      >
        {logoutLabel}
      </ActionButton>
    </SettingsSection>
  );
}
