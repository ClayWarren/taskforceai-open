import { describe, expect, it, vi } from 'bun:test';

vi.mock('@tanstack/react-router', () => ({
  useLocation: vi.fn(() => ({ pathname: '/test' })),
  useNavigate: vi.fn(() => vi.fn()),
  useSearch: vi.fn(() => ({})),
}));

import { useRouter, usePathname } from './useNavigation';

describe('useNavigation', () => {
  describe('useRouter', () => {
    it('returns router with navigation methods', () => {
      const router = useRouter();
      expect(router).toHaveProperty('push');
      expect(router).toHaveProperty('replace');
      expect(router).toHaveProperty('back');
      expect(router).toHaveProperty('forward');
      expect(router).toHaveProperty('navigate');
    });
  });

  describe('usePathname', () => {
    it('returns pathname from location', () => {
      const pathname = usePathname();
      expect(pathname).toBe('/test');
    });
  });
});
