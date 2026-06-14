import { useVoice } from '@taskforceai/voice';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('useMessageVoice');

export function useMessageVoice(content: string) {
  const { manager: voice, status: voiceStatus, error: voiceError } = useVoice();
  const [isSpeaking, setIsSpeaking] = useState(false);

  const toggleSpeech = useCallback(async () => {
    if (!content.trim()) {
      return;
    }

    if (isSpeaking) {
      try {
        await voice.cancel();
      } catch (error) {
        logger.error('Failed to stop playback', { error });
      } finally {
        setIsSpeaking(false);
      }
      return;
    }

    if (voiceStatus === 'error') {
      const reason =
        (voiceError instanceof Error && voiceError.message) || 'Voice playback is unavailable.';
      Alert.alert('Voice Unavailable', reason);
      return;
    }

    setIsSpeaking(true);
    try {
      await voice.init();
      await voice.speak(content);
    } catch (error) {
      logger.error('Failed to speak message', { error });
      Alert.alert('Playback Error', 'Unable to read the response aloud right now.');
    } finally {
      setIsSpeaking(false);
    }
  }, [isSpeaking, content, voice, voiceError, voiceStatus]);

  return {
    isSpeaking,
    toggleSpeech,
    voiceStatus,
  };
}
