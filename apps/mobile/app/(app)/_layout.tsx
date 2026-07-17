import { Stack } from 'expo-router';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import React from 'react';

import { configureRemoteQuickActions } from '../../src/features/desktop-work/quick-actions';

export default function AppLayout() {
  useQuickActionRouting();
  React.useEffect(() => {
    void configureRemoteQuickActions();
  }, []);
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
