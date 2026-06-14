// CSS class constants for DesktopAuthButtons
// Extracted to enable coverage exclusion for pure data

export const SIGN_IN_BUTTON_CLASSES = [
  'desktop-auth-buttons__button rounded-[14px] border border-white/15 bg-white/10 px-3.5 py-2.5',
  'font-semibold text-slate-100 shadow-[0_12px_26px_rgba(0,0,0,0.4)] transition',
  'hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/15',
];

export const SIGN_UP_BUTTON_CLASSES = [
  'desktop-auth-buttons__button desktop-auth-buttons__button--primary rounded-[14px] px-3.5 py-2.5',
  'font-semibold text-white shadow-[0_14px_32px_rgba(37,99,235,0.45),0_0_24px_rgba(59,130,246,0.35)] transition',
  'bg-gradient-to-r from-blue-600 to-blue-500',
];
