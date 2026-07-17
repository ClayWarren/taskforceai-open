import React from 'react';
import { Alert, View } from 'react-native';

import type { RemotePermissionProfile } from '../remote-composer-storage';
import { RemoteActionPill } from './RemoteControls';

const permissionLabels: Record<RemotePermissionProfile, string> = {
  read_only: 'Read only',
  workspace_write: 'Workspace write',
  full_access: 'Full access',
};

export function RemoteComposerControls({
  planMode,
  permissionProfile,
  onPlanModeChange,
  onPermissionProfileChange,
}: {
  planMode: boolean;
  permissionProfile: RemotePermissionProfile;
  onPlanModeChange: (enabled: boolean) => void;
  onPermissionProfileChange: (profile: RemotePermissionProfile) => void;
}) {
  const effectivePermission = planMode ? 'read_only' : permissionProfile;
  const choosePermission = () => {
    Alert.alert('Desktop permissions', 'Choose what this turn may do.', [
      {
        text: 'Read only',
        onPress: () => onPermissionProfileChange('read_only'),
      },
      {
        text: 'Workspace write',
        onPress: () => onPermissionProfileChange('workspace_write'),
      },
      {
        text: 'Full access',
        onPress: () => onPermissionProfileChange('full_access'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      <RemoteActionPill
        label="Plan"
        selected={planMode}
        onPress={() => onPlanModeChange(!planMode)}
      />
      <RemoteActionPill
        label={permissionLabels[effectivePermission]}
        selected={effectivePermission !== 'full_access'}
        disabled={planMode}
        onPress={choosePermission}
      />
    </View>
  );
}
