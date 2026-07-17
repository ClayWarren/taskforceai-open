import clsx from 'clsx';
import { Shield, ShieldCheck } from 'lucide-react';

interface PrivateChatToggleProps {
  isPrivateChat: boolean;
  isPrivateChatToggleDisabled: boolean;
  onTogglePrivateChat: () => void;
}

export function PrivateChatToggle({
  isPrivateChat,
  isPrivateChatToggleDisabled,
  onTogglePrivateChat,
}: PrivateChatToggleProps) {
  const PrivateChatIcon = isPrivateChat ? ShieldCheck : Shield;

  return (
    <button
      type="button"
      aria-label={isPrivateChat ? 'Turn off Private Chat' : 'Start Private Chat'}
      aria-pressed={isPrivateChat}
      className={clsx(
        'inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_18px_42px_rgba(2,6,23,0.28)]',
        'backdrop-blur-xl transition focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:outline-none',
        isPrivateChat
          ? 'border-emerald-300/55 bg-emerald-400/18 text-emerald-100 hover:border-emerald-200/75 hover:bg-emerald-400/24'
          : 'border-white/12 bg-white/[0.07] text-slate-200 hover:border-white/24 hover:bg-white/[0.12]',
        isPrivateChatToggleDisabled && 'cursor-not-allowed opacity-50'
      )}
      disabled={isPrivateChatToggleDisabled}
      onClick={onTogglePrivateChat}
      title={
        isPrivateChatToggleDisabled
          ? 'Private Chat is unavailable while a response is streaming'
          : isPrivateChat
            ? 'Private Chat is on'
            : 'Start Private Chat'
      }
    >
      <PrivateChatIcon aria-hidden="true" size={19} strokeWidth={2.1} />
      <span className="sr-only">{isPrivateChat ? 'Private Chat on' : 'Private Chat off'}</span>
    </button>
  );
}
