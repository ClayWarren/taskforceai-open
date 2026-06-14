import { Link, useLocation } from '@tanstack/react-router';
import {
  BarChart3,
  BookOpen,
  Code2,
  CreditCard,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { useAuth } from '../../lib/providers/AuthProvider';
import { clearCachedUsageStats } from '../../lib/developer/developer-dashboard';
import { logger } from '../../lib/logger';
import { cn } from '../../lib/utils';
import { authClient } from '../../lib/auth/auth-client';
import { Button } from '../ui/button';

interface NavItemProps {
  href: string;
  label: string;
  icon: React.ElementType;
  external?: boolean;
  onClick?: () => void;
}

function NavItem({ href, label, icon: Icon, external, onClick }: NavItemProps) {
  const location = useLocation();
  const isActive =
    location.pathname === href || (href !== '/' && location.pathname.startsWith(`${href}/`));

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="group flex items-center justify-between px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </div>
        <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    );
  }

  return (
    <Link
      to={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors hover:bg-white/5',
        isActive ? 'bg-white/5 text-white' : 'text-slate-400 hover:text-white'
      )}
    >
      <Icon className={cn('h-4 w-4', isActive ? 'text-blue-400' : 'text-slate-400')} />
      <span>{label}</span>
    </Link>
  );
}

export function ConsoleSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user, logout, isAuthenticated } = useAuth();

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/10 bg-black transition-transform lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Branding */}
        <div className="flex items-center justify-between p-6 pb-2">
          <Link to="/" className="flex items-center gap-2" onClick={onClose}>
            <span className="text-sm font-black tracking-tighter text-white uppercase italic">
              TaskForce<span className="text-blue-500">AI</span>
            </span>
            <Badge
              variant="outline"
              className="border-blue-500/30 bg-blue-500/10 px-1.5 py-0 text-[8px] font-bold text-blue-400 uppercase"
            >
              Console
            </Badge>
          </Link>
        </div>

        <nav className="flex-1 space-y-8 overflow-y-auto p-4 pt-0">
          <div>
            <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase">
              Build
            </p>
            <div className="space-y-1">
              <NavItem href="/" label="Dashboard" icon={LayoutDashboard} onClick={onClose} />
            </div>
          </div>

          <div>
            <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase">
              Manage
            </p>
            <div className="space-y-1">
              <NavItem href="/api-keys" label="API Keys" icon={KeyRound} onClick={onClose} />
              <NavItem href="/billing" label="Billing" icon={CreditCard} onClick={onClose} />
              <NavItem href="/usage" label="Usage" icon={BarChart3} onClick={onClose} />
              <NavItem href="/models" label="Models" icon={Zap} onClick={onClose} />
            </div>
          </div>

          <div>
            <p className="mb-2 px-3 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase">
              Resources
            </p>
            <div className="space-y-1">
              <NavItem
                href="https://docs.taskforceai.chat"
                label="Documentation"
                icon={BookOpen}
                external
                onClick={onClose}
              />
              <NavItem
                href="https://docs.taskforceai.chat/docs/api"
                label="API Reference"
                icon={Code2}
                external
                onClick={onClose}
              />
              <NavItem
                href="https://status.taskforceai.chat"
                label="System Status"
                icon={ShieldCheck}
                external
                onClick={onClose}
              />
            </div>
          </div>
        </nav>

        {/* User / Bottom Rail */}
        <div className="border-t border-white/10 p-4">
          {!isAuthenticated ? (
            <div className="px-2">
              <Button
                onClick={() => {
                  onClose();
                  window.location.href = authClient.getSignInUrl({
                    callbackUrl: window.location.href,
                  });
                }}
                className="w-full justify-start gap-3 bg-blue-600 hover:bg-blue-500"
              >
                <LogIn className="h-4 w-4" />
                <span>Sign in</span>
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <button
                  onClick={() => {
                    onClose();
                    const cacheClearResult = clearCachedUsageStats();
                    if (!cacheClearResult.ok) {
                      logger.warn('Failed to clear developer usage cache during logout', {
                        error: cacheClearResult.error,
                      });
                    }
                    void logout();
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </button>
              </div>

              <div className="mt-4 flex items-center gap-3 px-3 py-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-slate-800 text-xs font-bold text-white uppercase">
                  {user?.email?.charAt(0) ?? 'U'}
                </div>
                <div className="flex flex-col overflow-hidden text-xs">
                  <span className="truncate font-medium text-white">
                    {user?.full_name ?? 'User'}
                  </span>
                  <span className="truncate text-slate-400">{user?.email}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <a
            href="https://status.taskforceai.chat"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="group flex items-center justify-between text-[10px] font-bold tracking-widest text-slate-400 uppercase transition-colors hover:text-white"
          >
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              <span>System notice</span>
            </div>
            <ExternalLink className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        </div>
      </aside>
    </>
  );
}
