import React from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  listMobileRemoteConnections,
  type MobileRemoteTarget,
} from '../../../api/remote';
import { ActionButton } from '../../../components/ActionButton';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  pingDesktopAppServer,
  type DesktopPairingSession,
} from '../../../features/desktop-work/pairing/client';
import {
  completeRemotePairing,
  normalizeRemotePairingCode,
} from '../../../features/desktop-work/pairing/complete-pairing';
import { readOrCreateRemoteDeviceCredential } from '../../../features/desktop-work/pairing/remote-credential';
import {
  clearDesktopPairingSession,
  readDesktopPairingSession,
  saveDesktopPairingSession,
} from '../../../features/desktop-work/pairing/session-store';
import { syncStoredPushTokenWithDesktop } from '../../../notifications/registration';
import { sqliteStorage } from '../../../storage/sqlite-adapter';

interface DesktopPairingCardProps {
  initialPayload?: string | null;
}

export function DesktopPairingCard({ initialPayload }: DesktopPairingCardProps) {
  const { theme } = useTheme();
  const [code, setCode] = React.useState(() => normalizeRemotePairingCode(initialPayload));
  const [targets, setTargets] = React.useState<MobileRemoteTarget[]>([]);
  const [session, setSession] = React.useState<DesktopPairingSession | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scannerVisible, setScannerVisible] = React.useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const refresh = React.useCallback(async () => {
    const controllerDeviceId = await sqliteStorage.getDeviceId();
    const stored = await readDesktopPairingSession();
    setSession(stored);
    try {
      setTargets(await listMobileRemoteConnections(controllerDeviceId));
    } catch (caught) {
      setTargets([]);
      if (!stored && remoteErrorStatus(caught) === 403) return;
      throw caught;
    }
  }, []);

  React.useEffect(() => {
    void refresh().catch((caught) => {
      setError(caught instanceof Error ? caught.message : 'Remote connections could not be loaded.');
    });
  }, [refresh]);

  React.useEffect(() => {
    const nextCode = normalizeRemotePairingCode(initialPayload);
    if (nextCode) setCode(nextCode);
  }, [initialPayload]);

  const pair = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await completeRemotePairing(code);
      setSession(next);
      setCode('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Remote pairing failed.');
    } finally {
      setBusy(false);
    }
  };

  const connect = async (target: MobileRemoteTarget) => {
    setBusy(true);
    setError(null);
    try {
      const controllerDeviceId = await sqliteStorage.getDeviceId();
      const deviceCredential = await readOrCreateRemoteDeviceCredential();
      const next = remoteSession(target, controllerDeviceId, deviceCredential);
      await saveDesktopPairingSession(next, target.deviceName);
      setSession(next);
      await pingDesktopAppServer(next);
      await syncStoredPushTokenWithDesktop();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Mac is not available.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await clearDesktopPairingSession();
    setSession(await readDesktopPairingSession());
  };

  const openScanner = async () => {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (permission.granted) setScannerVisible(true);
    else setError('Camera access is required to scan a connection code.');
  };

  return (
    <View className="rounded-2xl border border-white/10 bg-white/5 px-md py-md">
      <View className="flex-row items-center justify-between gap-sm">
        <View className="min-w-0 flex-1">
          <Text className="text-text text-sm font-semibold">Remote</Text>
          <Text className="text-text-muted mt-1 text-xs">
            Control tasks running on your Mac from this phone.
          </Text>
        </View>
        <View className="flex-row items-center gap-xs">
          <View className={`h-2 w-2 rounded-full ${session ? 'bg-success' : 'bg-text-muted'}`} />
          <Text className="text-text-muted text-xs">{session ? 'Connected' : 'Not connected'}</Text>
        </View>
      </View>

      {session ? (
        <View className="mt-3 flex-row items-center justify-between rounded-xl border border-white/10 px-md py-sm">
          <View className="min-w-0 flex-1">
            <Text className="text-text text-xs font-semibold" numberOfLines={1}>
              {session.machineName ?? 'Mac'}
            </Text>
            <Text className="text-text-muted mt-0.5 text-[10px]">Available in Remote</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={() => void disconnect()}>
            <Text className="text-error text-xs font-semibold">Disconnect</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text className="text-text mt-4 text-xs font-semibold">Add connection</Text>
      <Text className="text-text-muted mt-1 text-xs">
        On the Mac, open Settings → Connections → Control this Mac, then choose Add.
      </Text>
      <View className="mt-3 flex-row gap-sm">
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="WV8D-JMXH"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Remote connection code"
          style={[
            styles.codeInput,
            { borderColor: theme.colors.border, color: theme.colors.text },
          ]}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Scan Remote connection QR code"
          onPress={() => void openScanner()}
          className="items-center justify-center rounded-xl border border-white/10 px-md"
        >
          <Text className="text-text text-xs font-semibold">Scan</Text>
        </TouchableOpacity>
      </View>
      <ActionButton
        accessibilityLabel="Connect with Remote code"
        onPress={() => void pair()}
        isLoading={busy}
        disabled={!code.trim() || busy}
      >
        Connect
      </ActionButton>

      {targets.length > 0 ? (
        <View className="mt-4 gap-xs">
          <Text className="text-text text-xs font-semibold">Your Macs</Text>
          {targets.map((target) => (
            <TouchableOpacity
              key={target.deviceId}
              accessibilityRole="button"
              accessibilityLabel={`Connect to ${target.deviceName}`}
              onPress={() => void connect(target)}
              disabled={!target.allowConnections || busy}
              className="flex-row items-center justify-between rounded-xl border border-white/10 px-md py-sm"
            >
              <View className="min-w-0 flex-1">
                <Text className="text-text text-xs font-semibold" numberOfLines={1}>{target.deviceName}</Text>
                <Text className="text-text-muted text-[10px]">
                  {target.allowConnections ? 'Remote enabled' : 'Remote disabled'}
                </Text>
              </View>
              <Text className="text-text-muted text-[10px]">
                {session?.targetDeviceId === target.deviceId ? 'Active' : 'Connect'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {error ? <Text className="text-error mt-3 text-xs">{error}</Text> : null}

      <Modal visible={scannerVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setScannerVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setCode(normalizeRemotePairingCode(data) || data);
              setScannerVisible(false);
              setError(null);
            }}
          />
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setScannerVisible(false)}
            style={{ position: 'absolute', alignSelf: 'center', bottom: 48, borderRadius: 999, backgroundColor: '#ffffff', paddingHorizontal: 20, paddingVertical: 11 }}
          >
            <Text style={{ color: '#000000', fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  codeInput: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 8,
    textAlign: 'center',
  },
});

const remoteErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object' || !("status" in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
};

const remoteSession = (
  target: MobileRemoteTarget,
  controllerDeviceId: string,
  deviceCredential: string
): DesktopPairingSession => ({
  baseUrl: `https://remote.taskforceai/device/${encodeURIComponent(target.deviceId)}`,
  rpcPath: '/rpc',
  sessionToken: 'account-scoped',
  sessionScope: 'mobile-control',
  transport: { kind: 'relay', encoding: 'json' },
  targetDeviceId: target.deviceId,
  controllerDeviceId,
  deviceCredential,
  machineName: target.deviceName,
});
