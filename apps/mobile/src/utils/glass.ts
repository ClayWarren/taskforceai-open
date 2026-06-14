import { Platform } from 'react-native';

const MIN_IOS_VERSION_FOR_GLASS = 17;

const normalizePlatformVersion = (): number => {
  const { Version } = Platform;

  if (typeof Version === 'number') {
    return Version;
  }

  if (typeof Version === 'string') {
    const parsed = parseFloat(Version);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

/**
 * Determines if the current device can render the glass effect.
 */
export const isGlassEffectSupported = (): boolean => {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return normalizePlatformVersion() >= MIN_IOS_VERSION_FOR_GLASS;
};
