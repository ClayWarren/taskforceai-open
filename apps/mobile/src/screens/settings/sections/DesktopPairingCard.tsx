import React from 'react';
import { Text, TextInput, View } from 'react-native';

import { ActionButton } from '../../../components/ActionButton';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  isPlainHttpDesktopPairingPayload,
  parseDesktopPairingPayload,
  pairWithDesktopAppServer,
  pingDesktopAppServer,
  type DesktopPairingSession,
} from '../../../desktop-pairing/client';
import {
  clearDesktopPairingSession,
  readDesktopPairingSession,
  saveDesktopPairingSession,
} from '../../../desktop-pairing/session-store';

type PairingState = 'idle' | 'checking' | 'pairing' | 'connected' | 'error';

interface DesktopPairingCardProps {
  initialPayload?: string | null;
}

export function DesktopPairingCard({ initialPayload }: DesktopPairingCardProps) {
  const { theme } = useTheme();
  const [payload, setPayload] = React.useState('');
  const [state, setState] = React.useState<PairingState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<DesktopPairingSession | null>(null);

  React.useEffect(() => {
    if (initialPayload) {
      return;
    }
    let active = true;
    const loadSession = async () => {
      const storedSession = await readDesktopPairingSession();
      if (!active || !storedSession) {
        return;
      }
      setState('checking');
      setError(null);
      try {
        await pingDesktopAppServer(storedSession);
        if (!active) {
          return;
        }
        setSession(storedSession);
        setState('connected');
      } catch (caught) {
        if (!active) {
          return;
        }
        setSession(null);
        setError(
          caught instanceof Error ? caught.message : 'Saved desktop pairing session is unavailable.'
        );
        setState('error');
      }
    };
    void loadSession();
    return () => {
      active = false;
    };
  }, [initialPayload]);

  React.useEffect(() => {
    if (!initialPayload) {
      return;
    }
    setPayload(initialPayload);
    setState('idle');
    setError(null);
    setSession(null);
  }, [initialPayload]);

  const handlePair = async () => {
    setState('pairing');
    setError(null);
    setWarning(null);
    setSession(null);
    try {
      const parsed = parseDesktopPairingPayload(payload);
      if (isPlainHttpDesktopPairingPayload(parsed)) {
        setWarning('Desktop pairing is using plain HTTP. Only continue on a trusted local network.');
      }
      const nextSession = await pairWithDesktopAppServer(parsed);
      await saveDesktopPairingSession(nextSession);
      setSession(nextSession);
      setState('connected');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Desktop pairing failed.');
      setState('error');
    }
  };

  const handleDisconnect = async () => {
    await clearDesktopPairingSession();
    setSession(null);
    setError(null);
    setWarning(null);
    setState('idle');
  };

  const isBusy = state === 'checking' || state === 'pairing';

  return (
    <View className="rounded-2xl border border-white/10 bg-white/5 px-md py-md">
      <View className="flex-row items-center justify-between gap-sm">
        <View className="min-w-0 flex-1">
          <Text className="text-text text-sm font-semibold">Desktop pairing</Text>
          <Text className="text-text-muted mt-1 text-xs">
            Connect to a desktop app-server pairing payload.
          </Text>
        </View>
        <View
          className={[
            'rounded-lg border px-sm py-xs',
            state === 'connected'
              ? 'border-success/50 bg-success/10'
              : state === 'error'
                ? 'border-error/50 bg-error/10'
                : 'border-white/10 bg-black/10',
          ].join(' ')}
        >
          <Text
            className={
              state === 'connected'
                ? 'text-success text-xs capitalize'
                : state === 'error'
                  ? 'text-error text-xs capitalize'
                  : 'text-text-muted text-xs capitalize'
            }
          >
            {state}
          </Text>
        </View>
      </View>

      <TextInput
        value={payload}
        onChangeText={setPayload}
        placeholder='{"baseUrl":"http://...","pairingCode":"..."}'
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        accessibilityLabel="Desktop pairing payload"
        className="mt-3 min-h-20 rounded-xl border border-white/10 px-md py-sm text-text"
      />

      {session ? (
        <Text className="text-text-muted mt-2 text-xs">Connected to {session.baseUrl}</Text>
      ) : null}
      {warning ? <Text className="text-warning mt-2 text-xs">{warning}</Text> : null}
      {error ? <Text className="text-error mt-2 text-xs">{error}</Text> : null}

      <ActionButton
        onPress={() => {
          void handlePair();
        }}
        isLoading={isBusy}
        disabled={!payload.trim() || isBusy}
      >
        {state === 'checking' ? 'Checking Desktop' : 'Pair with Desktop'}
      </ActionButton>
      {session ? (
        <ActionButton
          variant="danger"
          onPress={() => {
            void handleDisconnect();
          }}
        >
          Disconnect Desktop
        </ActionButton>
      ) : null}
    </View>
  );
}
