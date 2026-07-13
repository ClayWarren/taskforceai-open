import { LogIn, type LucideIcon } from 'lucide-react';

import { Button } from '@taskforceai/ui-kit/button';
import { getConsoleSignInUrl } from '../../lib/auth/sign-in';

interface AuthSignInGateProps {
  description: string;
  icon: LucideIcon;
  title: string;
}

export function AuthSignInGate({ description, icon: Icon, title }: AuthSignInGateProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 text-center duration-500 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/10">
        <Icon className="h-10 w-10 text-blue-500" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="text-slate-400">{description}</p>
      </div>
      <Button
        size="lg"
        onClick={() => (window.location.href = getConsoleSignInUrl(window.location.href))}
        className="gap-2 bg-blue-600 hover:bg-blue-500"
      >
        <LogIn className="h-4 w-4" />
        Sign in to continue
      </Button>
    </div>
  );
}
