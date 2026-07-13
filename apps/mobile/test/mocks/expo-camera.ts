import React from 'react';
import { View } from 'react-native';

export const CameraView = (props: Record<string, unknown>) =>
  React.createElement(View, { ...props, testID: 'mock-camera-view' });

export const useCameraPermissions = () => [
  { status: 'granted', granted: true },
  async () => ({ status: 'granted', granted: true }),
] as const;
