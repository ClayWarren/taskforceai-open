import { Link, Outlet, createFileRoute } from '@tanstack/react-router';
import { CreditCard, LogIn } from 'lucide-react';

import { Button } from '../components/ui/button';
import { authClient } from '../lib/auth/auth-client';
import { useAuth } from '../lib/providers/AuthProvider';

export const Route = createFileRoute('/billing')({
  component: BillingLayout,
});

const TABS = [
  { label: 'Overview', href: '/billing', exact: true },
  { label: 'Payment methods', href: '/billing/payment-methods' },
  { label: 'Billing history', href: '/billing/history' },
  { label: 'Preferences', href: '/billing/preferences' },
];

function BillingLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 text-center duration-500 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/10">
          <CreditCard className="h-10 w-10 text-blue-500" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-3xl font-bold text-white">Billing</h1>
          <p className="text-slate-400">
            Sign in to manage your subscription, payment methods, and invoices.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() =>
            (window.location.href = authClient.getSignInUrl({
              callbackUrl: window.location.href,
            }))
          }
          className="gap-2 bg-blue-600 hover:bg-blue-500"
        >
          <LogIn className="h-4 w-4" />
          Sign in to continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 duration-500 animate-in fade-in">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">Billing</h1>
      </div>

      <div className="border-b border-white/10">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              to={tab.href}
              activeOptions={{ exact: tab.exact }}
              activeProps={{ className: 'border-blue-500 text-blue-400' }}
              inactiveProps={{
                className:
                  'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300',
              }}
              className="border-b-2 py-4 text-sm font-medium transition-colors"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
