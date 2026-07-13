import React from 'react';

import { ActionButton } from '../../components/ActionButton';
import { Section as SettingsSection } from './components';

interface DataAccountActionsProps {
  title: string;
  isAuthenticated?: boolean;
  exportLabel: string;
  deleteLabel: string;
  logoutLabel: string;
  isLoading: boolean;
  onExport: () => void;
  onDelete: () => void;
  onLogout: () => void;
  onPrivacyPolicy: () => void;
  onTermsOfService: () => void;
  onContactSupport: () => void;
}

export function DataAccountActions({
  title,
  isAuthenticated = false,
  exportLabel,
  deleteLabel,
  logoutLabel,
  isLoading,
  onExport,
  onDelete,
  onLogout,
  onPrivacyPolicy,
  onTermsOfService,
  onContactSupport,
}: DataAccountActionsProps) {
  return (
    <>
      {isAuthenticated ? (
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
      ) : null}

      <SettingsSection title="Legal and support">
        <ActionButton
          style={{ marginHorizontal: 16, marginVertical: 8 }}
          className="mb-0"
          onPress={onPrivacyPolicy}
          accessibilityRole="link"
        >
          Privacy Policy
        </ActionButton>
        <ActionButton
          style={{ marginHorizontal: 16, marginVertical: 8 }}
          className="mb-0"
          onPress={onTermsOfService}
          accessibilityRole="link"
        >
          Terms of Service
        </ActionButton>
        <ActionButton
          style={{ marginHorizontal: 16, marginVertical: 8 }}
          className="mb-0"
          onPress={onContactSupport}
          accessibilityRole="link"
        >
          Contact Support
        </ActionButton>
      </SettingsSection>
    </>
  );
}
