import React from 'react';
import { Layers, Plus, Activity, Boxes, LogOut, FolderLock, HeartPulse } from 'lucide-react';

interface NavbarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isRealtimeConnected?: boolean;
  userEmail?: string | null;
  onSignOut?: () => void;
}

const tabClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold sm:px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
    active
      ? 'bg-white/[0.06] text-white'
      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
  }`;

export const Navbar: React.FC<NavbarProps> = ({
  currentPath,
  onNavigate,
  isRealtimeConnected = false,
  userEmail,
  onSignOut,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0a0a0a]/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Brand */}
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="group flex items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-emerald-400 transition-colors group-hover:border-white/20">
              <Layers className="h-4 w-4" />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-white lg:inline">
              Release Tracker
            </span>
          </button>

          {/* Realtime indicator + actions */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <span
              className="hidden items-center gap-2 rounded-full border border-white/5 bg-white/[0.03] px-2.5 py-1 sm:inline-flex"
              title={
                isRealtimeConnected
                  ? 'Realtime connected — updates stream in live'
                  : 'Realtime offline — use refresh to pull updates'
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isRealtimeConnected
                    ? 'animate-status-pulse bg-emerald-400 shadow-[0_0_6px_1px_rgba(52,211,153,0.5)]'
                    : 'bg-zinc-600'
                }`}
              />
              <span
                className={`text-[11px] font-medium ${
                  isRealtimeConnected ? 'text-emerald-400' : 'text-zinc-500'
                }`}
              >
                {isRealtimeConnected ? 'Live' : 'Offline'}
              </span>
            </span>

            <nav className="flex items-center gap-1" aria-label="Main">
              <button
                id="btn-nav-dashboard"
                aria-label="Dashboard"
                title="Dashboard"
                onClick={() => onNavigate('/')}
                aria-current={currentPath === '/' ? 'page' : undefined}
                className={tabClass(currentPath === '/')}
              >
                <Activity className="h-4 w-4 text-emerald-400" />
                <span className="hidden lg:inline">Dashboard</span>
              </button>
              <button
                id="btn-nav-catalog"
                aria-label="Catalog"
                title="Catalog"
                onClick={() => onNavigate('/catalog')}
                aria-current={currentPath === '/catalog' ? 'page' : undefined}
                className={tabClass(currentPath === '/catalog')}
              >
                <Boxes className="h-4 w-4 text-emerald-400" />
                <span className="hidden lg:inline">Catalog</span>
              </button>
              <button
                id="btn-nav-configs"
                aria-label="Configs"
                title="Configs"
                onClick={() => onNavigate('/configs')}
                aria-current={currentPath === '/configs' ? 'page' : undefined}
                className={tabClass(currentPath === '/configs')}
              >
                <FolderLock className="h-4 w-4 text-emerald-400" />
                <span className="hidden lg:inline">Configs</span>
              </button>
              <button
                id="btn-nav-health"
                aria-label="Health"
                title="Health"
                onClick={() => onNavigate('/health')}
                aria-current={currentPath === '/health' ? 'page' : undefined}
                className={tabClass(currentPath === '/health')}
              >
                <HeartPulse className="h-4 w-4 text-emerald-400" />
                <span className="hidden lg:inline">Health</span>
              </button>
            </nav>

            {currentPath !== '/add' && (
              <button
                id="btn-nav-add-record"
                aria-label="Add Record"
                title="Add Record"
                onClick={() => onNavigate('/add')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-2 text-sm font-semibold text-white sm:px-3.5 transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden lg:inline">Add Record</span>
              </button>
            )}

            {onSignOut && (
              <button
                id="btn-sign-out"
                onClick={onSignOut}
                title={userEmail ? `Signed in as ${userEmail}` : 'Sign out'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden max-w-[160px] truncate xl:inline">{userEmail || 'Sign out'}</span>
                <span className="sr-only">Sign out</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
