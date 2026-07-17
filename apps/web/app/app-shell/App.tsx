'use client';

import { usePlanCheckout } from '../lib/hooks/usePlanCheckout';
import { AppShell, type AppShellProps } from './AppShell';

export type { AppShellProps };

export default function App(props: AppShellProps) {
  // Trigger Stripe checkout if user lands with ?plan=pro/super after login
  usePlanCheckout();

  return <AppShell {...props} />;
}
