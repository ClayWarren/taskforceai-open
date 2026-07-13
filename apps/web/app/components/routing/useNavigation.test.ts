import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const navigateMock = vi.fn();
const useLocationMock = vi.fn(() => ({ pathname: '/test' }));
const useSearchMock = vi.fn(() => ({}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: useLocationMock,
  useNavigate: vi.fn(() => navigateMock),
  useSearch: useSearchMock,
}));

import { usePathname, useRouter, useSearchParams } from './useNavigation';

describe('useNavigation', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    useLocationMock.mockReturnValue({ pathname: '/test' });
    useSearchMock.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('useRouter', () => {
    it('forwards push, replace, and raw navigate calls to TanStack navigation', () => {
      const { result } = renderHook(() => useRouter());

      result.current.push('/chat');
      result.current.replace('/settings');
      result.current.navigate({ to: '/artifacts', search: { tab: 'recent' } });

      expect(navigateMock).toHaveBeenNthCalledWith(1, { to: '/chat' });
      expect(navigateMock).toHaveBeenNthCalledWith(2, { to: '/settings', replace: true });
      expect(navigateMock).toHaveBeenNthCalledWith(3, {
        to: '/artifacts',
        search: { tab: 'recent' },
      });
    });

    it('forwards back and forward to browser history', () => {
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
      const { result } = renderHook(() => useRouter());

      result.current.back();
      result.current.forward();

      expect(back).toHaveBeenCalledTimes(1);
      expect(forward).toHaveBeenCalledTimes(1);
    });
  });

  describe('usePathname', () => {
    it('returns pathname from location', () => {
      useLocationMock.mockReturnValue({ pathname: '/workspace' });

      const { result } = renderHook(() => usePathname());

      expect(result.current).toBe('/workspace');
    });
  });

  describe('useSearchParams', () => {
    it('stringifies search values and removes nullish entries', () => {
      useSearchMock.mockReturnValue({
        page: 2,
        active: true,
        empty: '',
        missing: undefined,
        none: null,
      });

      const { result } = renderHook(() => useSearchParams());

      expect(result.current.get('page')).toBe('2');
      expect(result.current.get('active')).toBe('true');
      expect(result.current.get('empty')).toBe('');
      expect(result.current.has('missing')).toBe(false);
      expect(result.current.has('none')).toBe(false);
      expect(useSearchMock).toHaveBeenCalledWith({ strict: false });
    });

    it('returns empty search params when router search is not an object', () => {
      useSearchMock.mockReturnValue(null as unknown as Record<string, unknown>);

      const { result } = renderHook(() => useSearchParams());

      expect(result.current.toString()).toBe('');
    });
  });
});
