import React from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { ActionButton } from '../../../components/ActionButton';
import { useTheme } from '../../../contexts/ThemeContext';
import { syncStoredPushTokenWithDesktop } from '../../../notifications/registration';
import {
  isPlainHttpDesktopPairingPayload,
  parseDesktopPairingPayload,
  pairWithDesktopAppServer,
  pingDesktopAppServer,
  revokeDesktopPairingSession,
  type DesktopPairingSession,
} from '../../../desktop-pairing/client';
import {
  clearDesktopPairingSession,
  readDesktopPairingHosts,
  readDesktopPairingSession,
  saveDesktopPairingSession,
  selectDesktopPairingHost,
  type DesktopPairingHost,
} from '../../../desktop-pairing/session-store';

type PairingState = 'idle' | 'checking' | 'pairing' | 'connected' | 'error';

interface DesktopPairingCardProps {
  initialPayload?: string | null;
}

export function DesktopPairingCard({ initialPayload }: DesktopPairingCardProps) {
  const { theme } = useTheme();
  const [payload, setPayload] = React.useState('');
  const [hostName, setHostName] = React.useState('');
  const [manualBaseUrl, setManualBaseUrl] = React.useState('');
  const [manualPairingCode, setManualPairingCode] = React.useState('');
  const [hosts, setHosts] = React.useState<DesktopPairingHost[]>([]);
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
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
      try {
        const [storedSession, storedHosts] = await Promise.all([
          readDesktopPairingSession(),
          readDesktopPairingHosts(),
        ]);
        if (active) setHosts(storedHosts);
        if (!active || !storedSession) {
          return;
        }
        setState('checking');
        setError(null);
        setSession(storedSession);
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
      const parsed = payload.trim()
        ? parseDesktopPairingPayload(payload)
        : {
            baseUrl: manualBaseUrl.trim(),
            pairingCode: manualPairingCode.trim(),
          };
      if (isPlainHttpDesktopPairingPayload(parsed)) {
        setWarning('Desktop pairing is using plain HTTP. Only continue on a trusted local network.');
      }
      const nextSession = await pairWithDesktopAppServer(parsed);
      if (hostName.trim()) await saveDesktopPairingSession(nextSession, hostName);
      else await saveDesktopPairingSession(nextSession);
      setHosts(await readDesktopPairingHosts());
      setSession(nextSession);
      setState('connected');
      await syncStoredPushTokenWithDesktop();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Desktop pairing failed.');
      setState('error');
    }
  };

  const handleDisconnect = async () => {
    try {
      if (session) {
        await revokeDesktopPairingSession(session);
      }
      await clearDesktopPairingSession();
      const [nextSession, nextHosts] = await Promise.all([
        readDesktopPairingSession(),
        readDesktopPairingHosts(),
      ]);
      setHosts(nextHosts);
      setSession(nextSession);
      setError(null);
      setWarning(null);
      setState(nextSession ? 'connected' : 'idle');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Desktop pairing session could not be cleared.'
      );
      setState('error');
    }
  };

  const isBusy = state === 'checking' || state === 'pairing';

  const openScanner = async () => {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (permission.granted) setScannerVisible(true);
    else setError('Camera access is required to scan a desktop pairing code.');
  };

  const selectHost = async (host: DesktopPairingHost) => {
    setState('checking');
    setError(null);
    try {
      await pingDesktopAppServer(host.session);
      const selected = await selectDesktopPairingHost(host.id);
      setSession(selected);
      setState('connected');
      await syncStoredPushTokenWithDesktop();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Saved desktop host is unavailable.');
      setState('error');
    }
  };

  const retrySession = async () => {
    if (!session) return;
    setState('checking');
    setError(null);
    try {
      await pingDesktopAppServer(session);
      setState('connected');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Desktop host is unavailable.');
      setState('error');
    }
  };

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

      <View className="mt-2 flex-row gap-sm">
        <TextInput
          value={hostName}
          onChangeText={setHostName}
          placeholder="Host name (optional)"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Desktop host name"
          className="min-w-0 flex-1 rounded-xl border border-white/10 px-md py-sm text-text"
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Scan desktop pairing QR code"
          onPress={() => void openScanner()}
          className="items-center justify-center rounded-xl border border-white/10 px-md"
        >
          <Text className="text-text text-xs font-semibold">Scan QR</Text>
        </TouchableOpacity>
      </View>

      <Text className="text-text-muted mt-3 text-xs">Or pair manually</Text>
      <View className="mt-2 gap-xs">
        <TextInput
          value={manualBaseUrl}
          onChangeText={setManualBaseUrl}
          placeholder="Desktop address, for example http://192.168.1.20:7319"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Desktop pairing address"
          className="rounded-xl border border-white/10 px-md py-sm text-text"
        />
        <TextInput
          value={manualPairingCode}
          onChangeText={setManualPairingCode}
          placeholder="Pairing code"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Desktop manual pairing code"
          className="rounded-xl border border-white/10 px-md py-sm text-text"
        />
      </View>

      {session ? (
        <Text className="text-text-muted mt-2 text-xs">Connected to {session.baseUrl}</Text>
      ) : null}

      {hosts.length > 1 ? (
        <View className="mt-3 gap-xs">
          <Text className="text-text text-xs font-semibold">Saved hosts</Text>
          {hosts.map((host) => (
            <TouchableOpacity
              key={host.id}
              accessibilityRole="button"
              accessibilityLabel={`Connect to desktop host ${host.name}`}
              onPress={() => void selectHost(host)}
              className="flex-row items-center justify-between rounded-xl border border-white/10 px-md py-sm"
            >
              <View className="min-w-0 flex-1">
                <Text className="text-text text-xs font-semibold" numberOfLines={1}>{host.name}</Text>
                <Text className="text-text-muted text-[10px]" numberOfLines={1}>{host.session.baseUrl}</Text>
              </View>
              <Text className="text-text-muted text-[10px]">
                {session?.baseUrl === host.session.baseUrl ? 'Active' : 'Connect'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Modal
        visible={scannerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setPayload(data);
              setScannerVisible(false);
              setError(null);
            }}
          />
          <View style={{ position: 'absolute', left: 20, right: 20, bottom: 50, gap: 12 }}>
            <Text style={{ color: '#ffffff', textAlign: 'center', fontWeight: '600' }}>
              Scan the pairing QR code shown by the TaskForceAI desktop app.
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close pairing scanner"
              onPress={() => setScannerVisible(false)}
              style={{ alignSelf: 'center', borderRadius: 999, backgroundColor: '#ffffff', paddingHorizontal: 20, paddingVertical: 11 }}
            >
              <Text style={{ color: '#000000', fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {warning ? <Text className="text-warning mt-2 text-xs">{warning}</Text> : null}
      {error ? <Text className="text-error mt-2 text-xs">{error}</Text> : null}

      <ActionButton
        onPress={() => {
          void handlePair();
        }}
        isLoading={isBusy}
        disabled={
          (!payload.trim() && (!manualBaseUrl.trim() || !manualPairingCode.trim())) || isBusy
        }
      >
        {state === 'checking' ? 'Checking Desktop' : 'Pair with Desktop'}
      </ActionButton>
      {session ? (
        state === 'error' ? (
          <ActionButton
            onPress={() => {
              void retrySession();
            }}
            isLoading={false}
          >
            Retry Desktop
          </ActionButton>
        ) : null
      ) : null}
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
