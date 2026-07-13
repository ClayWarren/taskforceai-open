import { z } from 'zod';

export const isValidEmail = (email: string): boolean => {
  try {
    z.string().email().parse(email);
    return true;
  } catch {
    return false;
  }
};

export const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};
