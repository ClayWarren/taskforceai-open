import { CameraView, useCameraPermissions } from 'expo-camera';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import {
  completeRemotePairing,
  normalizeRemotePairingCode,
} from '../../desktop-pairing/complete-pairing';
import { Icon } from '../Icon';

interface RemotePairingScreenProps {
  visible: boolean;
  onClose: () => void;
  onPaired?: () => void;
}

export function RemotePairingScreen({ visible, onClose, onPaired }: RemotePairingScreenProps) {
  const { theme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualVisible, setManualVisible] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scanned = React.useRef(false);
  const requestedPermission = React.useRef(false);

  React.useEffect(() => {
    if (!visible) {
      setManualVisible(false);
      setCode('');
      setError(null);
      scanned.current = false;
      requestedPermission.current = false;
      return;
    }
    if (
      permission &&
      !permission.granted &&
      permission.canAskAgain &&
      !requestedPermission.current
    ) {
      requestedPermission.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission, visible]);

  const pair = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await completeRemotePairing(value);
      onPaired?.();
      onClose();
    } catch (caught) {
      scanned.current = false;
      setError(caught instanceof Error ? caught.message : 'Remote pairing failed.');
    } finally {
      setBusy(false);
    }
  };

  const scan = ({ data }: { data: string }) => {
    if (scanned.current || busy) return;
    const pairingCode = normalizeRemotePairingCode(data);
    if (!pairingCode) {
      setError('That QR code is not a TaskForceAI Remote pairing code.');
      return;
    }
    scanned.current = true;
    void pair(pairingCode);
  };

  if (!visible) return null;

  return (
    <View
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
      accessibilityLabel="Remote pairing"
    >
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Close Remote pairing"
        onPress={onClose}
        style={[styles.closeButton, { backgroundColor: theme.colors.cardBackground }]}
      >
        <Icon name="X" size={24} color={theme.colors.text} />
      </TouchableOpacity>

      <View style={styles.scannerArea}>
        <View style={[styles.cameraFrame, { borderColor: theme.colors.border }]}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scan}
            />
          ) : (
            <View style={[styles.permissionState, { backgroundColor: theme.colors.cardBackground }]}>
              <Icon name="Monitor" size={36} color={theme.colors.textMuted} />
              <Text style={[styles.permissionText, { color: theme.colors.text }]}>Camera access is required to scan the desktop QR code.</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Allow camera access"
                onPress={() => void requestPermission()}
                style={[styles.permissionButton, { backgroundColor: theme.colors.primary }]}
              >
                <Text style={styles.primaryButtonText}>Allow camera</Text>
              </TouchableOpacity>
            </View>
          )}
          <View pointerEvents="none" style={styles.scanCorners}>
            <View style={[styles.corner, styles.topLeft, { borderColor: theme.colors.primary }]} />
            <View style={[styles.corner, styles.topRight, { borderColor: theme.colors.primary }]} />
            <View style={[styles.corner, styles.bottomLeft, { borderColor: theme.colors.primary }]} />
            <View style={[styles.corner, styles.bottomRight, { borderColor: theme.colors.primary }]} />
          </View>
          {busy ? (
            <View style={styles.busyOverlay}>
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          ) : null}
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>Scan QR code to pair</Text>
        {error ? <Text style={[styles.error, { color: theme.colors.error }]}>{error}</Text> : null}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Pair manually instead"
        onPress={() => {
          setError(null);
          setManualVisible(true);
        }}
        style={[styles.manualButton, { borderColor: theme.colors.border }]}
      >
        <Text style={[styles.manualButtonText, { color: theme.colors.text }]}>Pair manually instead</Text>
      </TouchableOpacity>

      {manualVisible ? (
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
          style={styles.manualOverlay}
        >
          <TouchableOpacity
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Cancel manual pairing"
            onPress={() => setManualVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.manualCard,
              { backgroundColor: theme.colors.cardBackground, borderColor: theme.colors.border },
            ]}
          >
            <Text style={[styles.manualTitle, { color: theme.colors.text }]}>Pair manually</Text>
            <Text style={[styles.manualHelp, { color: theme.colors.textMuted }]}>Enter the pairing code shown on your desktop.</Text>
            <TextInput
              autoFocus
              accessibilityLabel="Remote pairing code"
              value={code}
              onChangeText={(value) => setCode(value.toUpperCase())}
              placeholder="Pairing code"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              style={[
                styles.codeInput,
                {
                  backgroundColor: theme.colors.inputBackground,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                },
              ]}
              onSubmitEditing={() => void pair(code)}
            />
            {error ? <Text style={[styles.manualError, { color: theme.colors.error }]}>{error}</Text> : null}
            <View style={styles.manualActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel pairing"
                onPress={() => setManualVisible(false)}
                style={[styles.dialogButton, { borderColor: theme.colors.border }]}
              >
                <Text style={[styles.dialogButtonText, { color: theme.colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Pair with code"
                disabled={!normalizeRemotePairingCode(code) || busy}
                onPress={() => void pair(code)}
                style={[
                  styles.dialogButton,
                  { backgroundColor: theme.colors.primary, opacity: normalizeRemotePairingCode(code) && !busy ? 1 : 0.4 },
                ]}
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Pair</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const absoluteFill = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
} as const;

const styles = StyleSheet.create({
  screen: {
    ...absoluteFill,
    padding: 20,
    zIndex: 50,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  scannerArea: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 24 },
  cameraFrame: {
    aspectRatio: 0.88,
    borderCurve: 'continuous',
    borderRadius: 52,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 420,
    overflow: 'hidden',
    width: '72%',
  },
  permissionState: { alignItems: 'center', flex: 1, gap: 18, justifyContent: 'center', padding: 28 },
  permissionText: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  permissionButton: { borderRadius: 18, paddingHorizontal: 20, paddingVertical: 12 },
  scanCorners: { ...absoluteFill },
  corner: { height: 46, position: 'absolute', width: 46 },
  topLeft: { borderLeftWidth: 4, borderTopWidth: 4, left: 36, top: 36 },
  topRight: { borderRightWidth: 4, borderTopWidth: 4, right: 36, top: 36 },
  bottomLeft: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: 36, left: 36 },
  bottomRight: { borderBottomWidth: 4, borderRightWidth: 4, bottom: 36, right: 36 },
  busyOverlay: { ...absoluteFill, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, maxWidth: 320, textAlign: 'center' },
  manualButton: { alignItems: 'center', borderCurve: 'continuous', borderRadius: 28, borderWidth: 1, paddingVertical: 17 },
  manualButtonText: { fontSize: 17, fontWeight: '700' },
  manualOverlay: { ...absoluteFill, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', padding: 28 },
  manualCard: { borderCurve: 'continuous', borderRadius: 30, borderWidth: StyleSheet.hairlineWidth, padding: 24 },
  manualTitle: { fontSize: 21, fontWeight: '700' },
  manualHelp: { fontSize: 16, lineHeight: 22, marginTop: 6 },
  codeInput: { borderCurve: 'continuous', borderRadius: 24, borderWidth: 1, fontSize: 18, marginTop: 22, paddingHorizontal: 18, paddingVertical: 15 },
  manualError: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  manualActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  dialogButton: { alignItems: 'center', borderCurve: 'continuous', borderRadius: 22, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48 },
  dialogButtonText: { fontSize: 17, fontWeight: '600' },
  primaryButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
});
