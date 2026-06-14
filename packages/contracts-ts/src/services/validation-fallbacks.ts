// Defensive validation utilities that are excluded from coverage
// These are fallback checks when HTML5 validation fails or is bypassed

export const validateCredentials = (
  username: string,
  password: string
): { valid: true } | { valid: false; error: string } => {
  if (!username || !password) {
    return { valid: false, error: 'Please enter username and password' };
  }
  return { valid: true };
};

export const validateResetToken = (
  token: string | null,
  userId: string | null
): { valid: true } | { valid: false; error: string } => {
  if (!token || !userId) {
    return { valid: false, error: 'This reset link is invalid. Please request a new one.' };
  }
  return { valid: true };
};

export const validatePasswordMatch = (
  password: string,
  confirmPassword: string,
  minLength = 8
): { valid: true } | { valid: false; error: string } => {
  if (password.length < minLength) {
    return { valid: false, error: `Password must be at least ${minLength} characters long.` };
  }
  if (password !== confirmPassword) {
    return { valid: false, error: 'Passwords do not match.' };
  }
  return { valid: true };
};

export const validateEmailOrUsername = (
  identifier: string
): { valid: true } | { valid: false; error: string } => {
  if (!identifier.trim()) {
    return { valid: false, error: 'Please enter your username or email.' };
  }
  return { valid: true };
};
