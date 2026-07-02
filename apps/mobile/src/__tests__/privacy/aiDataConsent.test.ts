import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { requestAiDataSharingConsent } from '../../privacy/aiDataConsent';

const staleConsentKey = '@taskforceai:ai-data-sharing-consent:v1';
const consentKey = '@taskforceai:ai-data-sharing-consent:v2';

describe('requestAiDataSharingConsent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('returns true without prompting when consent was already accepted', async () => {
    await AsyncStorage.setItem(consentKey, 'accepted');

    await expect(requestAiDataSharingConsent()).resolves.toBe(true);

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('prompts again when only the previous provider disclosure was accepted', async () => {
    await AsyncStorage.setItem(staleConsentKey, 'accepted');
    jest.mocked(Alert.alert).mockImplementationOnce((_title, message, buttons) => {
      expect(message).toEqual(expect.stringContaining('Z.ai'));
      buttons?.[1]?.onPress?.();
    });

    await expect(requestAiDataSharingConsent()).resolves.toBe(true);

    await expect(AsyncStorage.getItem(staleConsentKey)).resolves.toBe('accepted');
    await expect(AsyncStorage.getItem(consentKey)).resolves.toBe('accepted');
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('records consent when the user allows AI provider sharing', async () => {
    jest.mocked(Alert.alert).mockImplementationOnce((_title, _message, buttons) => {
      buttons?.[1]?.onPress?.();
    });

    await expect(requestAiDataSharingConsent()).resolves.toBe(true);

    await expect(AsyncStorage.getItem(consentKey)).resolves.toBe('accepted');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Share with AI providers?',
      expect.stringContaining('TaskForceAI sends your prompt'),
      expect.any(Array),
      expect.objectContaining({ cancelable: true })
    );
  });

  it('returns false when the user cancels or dismisses the disclosure', async () => {
    jest.mocked(Alert.alert).mockImplementationOnce((_title, _message, buttons) => {
      buttons?.[0]?.onPress?.();
    });

    await expect(requestAiDataSharingConsent()).resolves.toBe(false);

    jest.mocked(Alert.alert).mockImplementationOnce((_title, _message, _buttons, options) => {
      options?.onDismiss?.();
    });

    await expect(requestAiDataSharingConsent()).resolves.toBe(false);
  });

  it('returns false when consent persistence fails', async () => {
    jest.mocked(Alert.alert).mockImplementationOnce((_title, _message, buttons) => {
      jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
      buttons?.[1]?.onPress?.();
    });

    await expect(requestAiDataSharingConsent()).resolves.toBe(false);
  });
});
