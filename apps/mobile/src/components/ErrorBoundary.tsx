import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorTokens } from '@taskforceai/design-tokens';
import * as Updates from 'expo-updates';
import { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import * as FileSystem from '../utils/file-system';
import { createModuleLogger } from '../logger';
import { clearAuthToken } from '../auth/token-store';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const logger = createModuleLogger('ErrorBoundary');

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // mobileLogger is already configured to send to Sentry via @taskforceai/observability,
    // so we don't need a manual Sentry.captureException here.
    logger.error('ErrorBoundary caught an error', {
      error,
      componentStack: errorInfo?.componentStack,
    });
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleHardReset = (): void => {
    Alert.alert(
      'Reset All App Data?',
      'This will delete all local chat history, settings, and logout. This cannot be undone and is intended as a last resort if the app keeps crashing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset & Restart',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                // 1. Clear AsyncStorage
                await AsyncStorage.clear();
                await clearAuthToken();

                // 2. Delete SQLite database
                const dbDir = `${FileSystem.documentDirectory}SQLite/`;
                const dbFile = `${dbDir}taskforceai.db`;
                const info = await FileSystem.getInfoAsync(dbFile);
                if (info.exists) {
                  await FileSystem.deleteAsync(dbFile, { idempotent: true });
                  // Also clean up WAL/SHM files if they exist
                  await FileSystem.deleteAsync(`${dbFile}-wal`, { idempotent: true });
                  await FileSystem.deleteAsync(`${dbFile}-shm`, { idempotent: true });
                }

                // 3. Reload app
                await Updates.reloadAsync();
              } catch (err) {
                logger.error('Hard reset failed', { error: err });
                Alert.alert('Reset Failed', 'Please try again or reinstall the app.');
              }
            })();
          },
        },
      ]
    );
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View className="px-xxl flex-1 items-center justify-center bg-background">
          <View style={{ maxWidth: 400 }} className="items-center">
            <Text className="mb-md text-error text-center text-2xl font-bold">
              Something went wrong
            </Text>
            <Text className="mb-lg text-text text-center text-base leading-6">
              The app encountered an unexpected error. This has been logged and will be fixed soon.
            </Text>

            {__DEV__ && this.state.error && (
              <View
                className="mb-lg px-md py-md w-full rounded-xl border"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  borderColor: colorTokens.dark.error,
                }}
              >
                <Text className="mb-sm text-error text-xs font-semibold">
                  Error Details (Dev Only):
                </Text>
                <Text className="mb-sm text-text text-xs" style={{ fontFamily: 'Courier' }}>
                  {this.state.error.toString()}
                </Text>
                {this.state.errorInfo && (
                  <Text className="text-text-muted text-[10px]" style={{ fontFamily: 'Courier' }}>
                    {this.state.errorInfo.componentStack}
                  </Text>
                )}
              </View>
            )}

            <View className="w-full gap-y-md">
              <TouchableOpacity
                className="px-xl py-md w-full rounded-xl bg-primary"
                onPress={this.handleReset}
              >
                <Text className="text-center text-base font-semibold text-white">Try Again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="px-xl py-md w-full rounded-xl border border-error/50"
                onPress={this.handleHardReset}
              >
                <Text className="text-center text-base font-semibold text-error">
                  Reset App Data & Restart
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}
