import { Outlet } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@taskforceai/ui-kit/button';
import { ConsoleSidebar } from './ConsoleSidebar';

export function ConsoleLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  return (
    <div className="flex min-h-screen bg-black text-slate-100">
      {/* Mobile Header */}
      <div className="fixed top-0 right-0 left-0 z-40 flex h-16 items-center border-b border-white/10 bg-black px-4 lg:hidden">
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          onClick={() => setIsSidebarOpen(true)}
          className="text-slate-400 hover:text-white"
          aria-label="Open navigation"
          aria-expanded={isSidebarOpen}
          aria-controls="console-sidebar"
        >
          <Menu className="h-6 w-6" />
        </Button>
        <div className="ml-4 flex items-center gap-2">
          <span className="text-sm font-black tracking-tighter text-white uppercase italic">
            TaskForce<span className="text-blue-500">AI</span>
          </span>
        </div>
      </div>

      <ConsoleSidebar isOpen={isSidebarOpen} onClose={closeSidebar} />

      <main className="min-w-0 flex-1 lg:pl-64">
        <div className="mx-auto max-w-6xl p-8 pt-24 lg:p-12 lg:pt-12">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
