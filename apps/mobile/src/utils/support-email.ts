import * as Clipboard from 'expo-clipboard';
import { Alert, Linking } from 'react-native';

import { legalLinks } from '../config/legal-links';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('SupportEmail');
const SUPPORT_EMAIL = legalLinks.supportEmail.replace(/^mailto:/, '');

const showSupportEmailFallback = () => {
  Alert.alert('Email unavailable', `Email us at ${SUPPORT_EMAIL}.`, [
    {
      text: 'Copy email',
      onPress: () => {
        void Clipboard.setStringAsync(SUPPORT_EMAIL).catch((error: unknown) => {
          logger.warn('Failed to copy support email', { error });
        });
      },
    },
    { text: 'OK' },
  ]);
};

export const openSupportEmail = async (): Promise<void> => {
  try {
    const canOpenEmail = await Linking.canOpenURL(legalLinks.supportEmail);
    if (!canOpenEmail) {
      showSupportEmailFallback();
      return;
    }
    await Linking.openURL(legalLinks.supportEmail);
  } catch (error: unknown) {
    logger.warn('Support email handler unavailable', { error });
    showSupportEmailFallback();
  }
};
