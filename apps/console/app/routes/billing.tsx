import { Link, Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { CreditCard } from 'lucide-react';

import { useAuth } from '@taskforceai/ui-kit/auth/AuthProvider';
import { AuthLoadingState } from '../components/auth/AuthLoadingState';
import { AuthSignInGate } from '../components/auth/AuthSignInGate';

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
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const location = useLocation();

  if (isAuthLoading) {
    return <AuthLoadingState label="Loading billing account" />;
  }

  if (!isAuthenticated) {
    return (
      <AuthSignInGate
        icon={CreditCard}
        title="Billing"
        description="Sign in to manage your subscription, payment methods, and invoices."
      />
    );
  }

  return (
    <div className="space-y-8 duration-500 animate-in fade-in">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">Billing</h1>
      </div>

      <div className="border-b border-white/10">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => {
            const isActive = tab.exact
              ? location.pathname === tab.href
              : location.pathname === tab.href || location.pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                to={tab.href}
                className={`border-b-2 py-4 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
