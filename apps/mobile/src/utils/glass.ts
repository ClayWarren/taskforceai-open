import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * Determines if the current device can render the glass effect.
 */
export const isGlassEffectSupported = (): boolean => {
  return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
};
