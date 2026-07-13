import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

import { isGlassEffectSupported } from '../../utils/glass';

jest.mock('expo-glass-effect', () => ({
  isGlassEffectAPIAvailable: jest.fn(),
  isLiquidGlassAvailable: jest.fn(),
}));

const mockIsGlassEffectAPIAvailable = jest.mocked(isGlassEffectAPIAvailable);
const mockIsLiquidGlassAvailable = jest.mocked(isLiquidGlassAvailable);

describe('glass utils', () => {
  beforeEach(() => {
    mockIsGlassEffectAPIAvailable.mockReset();
    mockIsLiquidGlassAvailable.mockReset();
  });

  describe('isGlassEffectSupported', () => {
    it('returns true when Liquid Glass and its native API are both available', () => {
      mockIsLiquidGlassAvailable.mockReturnValue(true);
      mockIsGlassEffectAPIAvailable.mockReturnValue(true);

      expect(isGlassEffectSupported()).toBe(true);
    });

    it('returns false when Liquid Glass is unavailable', () => {
      mockIsLiquidGlassAvailable.mockReturnValue(false);

      expect(isGlassEffectSupported()).toBe(false);
      expect(mockIsGlassEffectAPIAvailable).not.toHaveBeenCalled();
    });

    it('returns false when the native Glass Effect API is unavailable', () => {
      mockIsLiquidGlassAvailable.mockReturnValue(true);
      mockIsGlassEffectAPIAvailable.mockReturnValue(false);

      expect(isGlassEffectSupported()).toBe(false);
    });
  });
});
