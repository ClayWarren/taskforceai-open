import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

export const AI_DATA_SHARING_CONSENT_KEY = '@taskforceai:ai-data-sharing-consent:v1';

export const AI_DATA_SHARING_DISCLOSURE =
  'TaskForceAI sends your prompt, attachments, conversation context, and selected model settings to TaskForceAI servers and third-party AI providers including OpenAI, Anthropic, Google, xAI, Mistral, Moonshot, and Vercel AI Gateway to generate responses. Do not include sensitive personal data unless you want it processed for your request.';

export async function hasAcceptedAiDataSharing(): Promise<boolean> {
  return (await AsyncStorage.getItem(AI_DATA_SHARING_CONSENT_KEY)) === 'accepted';
}

export async function recordAiDataSharingConsent(): Promise<void> {
  await AsyncStorage.setItem(AI_DATA_SHARING_CONSENT_KEY, 'accepted');
}

export async function requestAiDataSharingConsent(): Promise<boolean> {
  if (await hasAcceptedAiDataSharing()) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    Alert.alert(
      'Share with AI providers?',
      AI_DATA_SHARING_DISCLOSURE,
      [
        { text: 'Not Now', style: 'cancel', onPress: () => settle(false) },
        {
          text: 'Allow',
          onPress: () => {
            void recordAiDataSharingConsent()
              .then(() => settle(true))
              .catch(() => settle(false));
          },
        },
      ],
      { cancelable: true, onDismiss: () => settle(false) }
    );
  });
}
