import type { LogLevel } from './types';

export const getLevelValue = (level: LogLevel): number => {
  switch (level) {
    case 'debug':
      return 0;
    case 'info':
      return 1;
    case 'warn':
      return 2;
    case 'error':
      return 3;
  }
};
