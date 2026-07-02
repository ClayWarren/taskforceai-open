import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getMobileClient } from '../../../api/client';
import { ActionButton } from '../../../components/ActionButton';
import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import { createModuleLogger } from '../../../logger';
import { InfoBox, Section, SettingRow } from '../components';

const logger = createModuleLogger('SecuritySection');

interface SecuritySectionProps {
  authenticatorEnabled: boolean;
  onStatusChange: () => Promise<void>;
}

export function SecuritySection({
  authenticatorEnabled,
  onStatusChange,
}: SecuritySectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [enabled, setEnabled] = React.useState(authenticatorEnabled);
  const [setupSecret, setSetupSecret] = React.useState<string | null>(null);
  const [setupCode, setSetupCode] = React.useState('');
  const [disableCode, setDisableCode] = React.useState('');
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);

  React.useEffect(() => {
    setEnabled(authenticatorEnabled);
  }, [authenticatorEnabled]);

  const resetSetup = () => {
    setSetupSecret(null);
    setSetupCode('');
  };

  const beginSetup = async () => {
    setIsBusy(true);
    try {
      const response = await getMobileClient().setupAuthenticatorMFA();
      setSetupSecret(response.secret);
      setDisableOpen(false);
    } catch (error) {
      logger.error('Failed to start authenticator MFA setup', { error });
      Alert.alert(
        t('mobile.settings.mfaSetupErrorTitle', { defaultValue: 'Setup failed' }),
        t('mobile.settings.mfaSetupErrorMessage', {
          defaultValue: 'Could not start authenticator setup. Please try again.',
        })
      );
    } finally {
      setIsBusy(false);
    }
  };

  const verifySetup = async () => {
    const code = setupCode.trim();
    if (code.length < 6) {
      Alert.alert(
        t('mobile.settings.mfaCodeRequiredTitle', { defaultValue: 'Code required' }),
        t('mobile.settings.mfaCodeRequiredMessage', {
          defaultValue: 'Enter the 6-digit code from your authenticator app.',
        })
      );
      return;
    }

    setIsBusy(true);
    try {
      await getMobileClient().verifyAuthenticatorMFA(code);
      setEnabled(true);
      resetSetup();
      await onStatusChange();
      Alert.alert(
        t('mobile.settings.mfaEnabledTitle', { defaultValue: 'Authenticator app enabled' }),
        t('mobile.settings.mfaEnabledMessage', {
          defaultValue: 'Your account now requires authenticator codes at sign-in.',
        })
      );
    } catch (error) {
      logger.error('Failed to verify authenticator MFA setup', { error });
      Alert.alert(
        t('mobile.settings.mfaInvalidCodeTitle', { defaultValue: 'Invalid code' }),
        t('mobile.settings.mfaInvalidCodeMessage', {
          defaultValue: 'Check the code in your authenticator app and try again.',
        })
      );
    } finally {
      setIsBusy(false);
    }
  };

  const disableAuthenticator = async () => {
    const code = disableCode.trim();
    if (code.length < 6) {
      Alert.alert(
        t('mobile.settings.mfaCodeRequiredTitle', { defaultValue: 'Code required' }),
        t('mobile.settings.mfaCodeRequiredMessage', {
          defaultValue: 'Enter the 6-digit code from your authenticator app.',
        })
      );
      return;
    }

    setIsBusy(true);
    try {
      await getMobileClient().disableAuthenticatorMFA(code);
      setEnabled(false);
      setDisableCode('');
      setDisableOpen(false);
      await onStatusChange();
      Alert.alert(
        t('mobile.settings.mfaDisabledTitle', { defaultValue: 'Authenticator app disabled' }),
        t('mobile.settings.mfaDisabledMessage', {
          defaultValue: 'Authenticator codes are no longer required at sign-in.',
        })
      );
    } catch (error) {
      logger.error('Failed to disable authenticator MFA', { error });
      Alert.alert(
        t('mobile.settings.mfaInvalidCodeTitle', { defaultValue: 'Invalid code' }),
        t('mobile.settings.mfaInvalidCodeMessage', {
          defaultValue: 'Check the code in your authenticator app and try again.',
        })
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggle = (nextEnabled: boolean) => {
    if (nextEnabled) {
      void beginSetup();
      return;
    }
    resetSetup();
    setDisableOpen(true);
  };

  const copySetupSecret = async () => {
    if (!setupSecret) return;
    await Clipboard.setStringAsync(setupSecret);
  };

  return (
    <View>
      <Section title={t('mobile.settings.loginSection', { defaultValue: 'Log in' })}>
        <SettingRow
          label={t('mobile.settings.mfaAuthenticatorApp', { defaultValue: 'Authenticator app' })}
          description={t('mobile.settings.mfaAuthenticatorDescription', {
            defaultValue: 'Use one-time codes from an authenticator app.',
          })}
        >
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            trackColor={{ false: '#767577', true: theme.colors.primary }}
            thumbColor={enabled ? theme.colors.white : '#f4f3f4'}
            disabled={isBusy}
            accessibilityLabel={t('mobile.settings.mfaAuthenticatorApp', {
              defaultValue: 'Authenticator app',
            })}
            accessibilityRole="switch"
          />
        </SettingRow>
        <SettingRow
          label={t('mobile.settings.mfaTextMessages', { defaultValue: 'Text messages' })}
          description={t('mobile.settings.mfaTextMessagesUnavailable', {
            defaultValue: 'SMS verification is not available yet.',
          })}
        >
          <Text style={[styles.statusText, { color: theme.colors.textMuted }]}>
            {t('mobile.settings.off', { defaultValue: 'Off' })}
          </Text>
        </SettingRow>
      </Section>

      {setupSecret ? (
        <Section title={t('mobile.settings.mfaSetupTitle', { defaultValue: 'Authenticator setup' })}>
          <InfoBox label={t('mobile.settings.mfaSetupKey', { defaultValue: 'Setup key' })}>
            {setupSecret}
          </InfoBox>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('mobile.settings.mfaCopySetupKey', {
              defaultValue: 'Copy setup key',
            })}
            onPress={() => {
              void copySetupSecret();
            }}
            style={styles.copyButton}
          >
            <Icon name="Copy" size={16} color={theme.colors.text} />
            <Text style={[styles.copyText, { color: theme.colors.text }]}>
              {t('mobile.settings.mfaCopySetupKey', { defaultValue: 'Copy setup key' })}
            </Text>
          </TouchableOpacity>
          <View style={styles.codeBlock}>
            <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
              {t('mobile.settings.mfaVerificationCode', { defaultValue: 'Verification code' })}
            </Text>
            <TextInput
              value={setupCode}
              onChangeText={(value) => setSetupCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="000000"
              placeholderTextColor={theme.colors.textMuted}
              maxLength={6}
              editable={!isBusy}
              style={[
                styles.codeInput,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                },
              ]}
            />
            <View style={styles.actionRow}>
              <ActionButton
                size="large"
                className="mb-0 flex-1"
                isLoading={isBusy}
                disabled={isBusy}
                onPress={() => {
                  void verifySetup();
                }}
              >
                {t('mobile.settings.mfaVerify', { defaultValue: 'Verify' })}
              </ActionButton>
              <ActionButton
                size="large"
                variant="default"
                className="mb-0 flex-1"
                disabled={isBusy}
                onPress={resetSetup}
              >
                {t('mobile.settings.cancel', { defaultValue: 'Cancel' })}
              </ActionButton>
            </View>
          </View>
        </Section>
      ) : null}

      {disableOpen ? (
        <Section title={t('mobile.settings.mfaDisableTitle', { defaultValue: 'Disable MFA' })}>
          <View style={styles.codeBlock}>
            <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
              {t('mobile.settings.mfaCurrentCode', { defaultValue: 'Current authenticator code' })}
            </Text>
            <TextInput
              value={disableCode}
              onChangeText={(value) => setDisableCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="000000"
              placeholderTextColor={theme.colors.textMuted}
              maxLength={6}
              editable={!isBusy}
              style={[
                styles.codeInput,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                },
              ]}
            />
            <View style={styles.actionRow}>
              <ActionButton
                size="large"
                variant="danger"
                className="mb-0 flex-1"
                isLoading={isBusy}
                disabled={isBusy}
                onPress={() => {
                  void disableAuthenticator();
                }}
              >
                {t('mobile.settings.mfaDisableAuthenticator', {
                  defaultValue: 'Disable authenticator',
                })}
              </ActionButton>
              <ActionButton
                size="large"
                variant="default"
                className="mb-0 flex-1"
                disabled={isBusy}
                onPress={() => {
                  setDisableCode('');
                  setDisableOpen(false);
                }}
              >
                {t('mobile.settings.cancel', { defaultValue: 'Cancel' })}
              </ActionButton>
            </View>
          </View>
        </Section>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  statusText: {
    fontSize: 15,
    fontWeight: '500',
  },
  copyButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  copyText: {
    fontSize: 15,
    fontWeight: '500',
  },
  codeBlock: {
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  codeInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    letterSpacing: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
});
