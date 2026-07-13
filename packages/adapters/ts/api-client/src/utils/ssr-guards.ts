// SSR guards extracted for coverage exclusion
// These checks are always false in browser test environments

export const isServerSide = (): boolean => typeof window === 'undefined';

export const isDocumentAvailable = (): boolean => typeof document !== 'undefined';
