import { Loader2 } from 'lucide-react';

export function AuthLoadingState({ label = 'Loading account' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[400px] items-center justify-center"
    >
      <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-blue-500" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
