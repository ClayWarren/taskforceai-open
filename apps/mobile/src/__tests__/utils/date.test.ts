import { formatMessageTime } from '../../utils/date';

jest.mock('../../i18n', () => ({
  __esModule: true,
  default: {
    language: 'en-US',
  },
}));

describe('date utils', () => {
  describe('formatMessageTime', () => {
    it('formats timestamp to time string', () => {
      const timestamp = new Date(2024, 0, 1, 10, 30).getTime();
      const result = formatMessageTime(timestamp);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('formats Date object to time string', () => {
      const date = new Date(2024, 0, 1, 14, 45);
      const result = formatMessageTime(date);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('formats ISO string to time string', () => {
      const isoString = '2024-01-01T09:15:00.000Z';
      const result = formatMessageTime(isoString);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('returns empty string for invalid timestamp', () => {
      const result = formatMessageTime('invalid');
      expect(result).toBe('');
    });

    it('returns empty string for NaN timestamp', () => {
      const result = formatMessageTime(NaN);
      expect(result).toBe('');
    });

    it('handles null timestamp', () => {
      const result = formatMessageTime(null as any);
      expect(typeof result).toBe('string');
    });

    it('handles undefined timestamp', () => {
      const result = formatMessageTime(undefined as any);
      expect(typeof result).toBe('string');
    });
  });

});
