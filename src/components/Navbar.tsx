import React from 'react';
import { Layers, Plus, ScrollText, Network, LogOut, FolderLock, HeartPulse, GitCompareArrows, Route, GitBranch } from 'lucide-react';

// Main sections, in the order an operator works: what was released, what
// differs, what to patch, which features it carries, then config, health and
// the servers themselves.
export const NAV_ITEMS = [
  { path: '/', id: 'btn-nav-dashboard', label: 'Releases', icon: ScrollText },
  { path: '/differences', id: 'btn-nav-differences', label: 'Differences', icon: GitCompareArrows },
  { path: '/plan', id: 'btn-nav-plan', label: 'Patch Planner', icon: Route },
  { path: '/changes', id: 'btn-nav-changes', label: 'Changes', icon: GitBranch },
  { path: '/configs', id: 'btn-nav-configs', label: 'Configuration', icon: FolderLock },
  { path: '/health', id: 'btn-nav-health', label: 'Health', icon: HeartPulse },
  { path: '/infrastructure', id: 'btn-nav-infrastructure', label: 'Infrastructure', icon: Network },
] as const;

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
      ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30'
      : 'text-zinc-300 hover:bg-white/[0.08] hover:text-white'
  }`;

export const Navbar: React.FC<NavbarProps> = ({
  currentPath,
  onNavigate,
  isRealtimeConnected = false,
  userEmail,
  onSignOut,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-surface-base/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-2">
          {/* Brand */}
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="group flex items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-emerald-400 transition-colors group-hover:border-white/30">
              <Layers className="h-4 w-4" />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-white 2xl:inline">
              Release Tracker
            </span>
          </button>

          {/* Realtime indicator + actions */}
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <span
              className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 md:inline-flex"
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
                  isRealtimeConnected ? 'text-emerald-400' : 'text-zinc-400'
                }`}
              >
                {isRealtimeConnected ? 'Live' : 'Offline'}
              </span>
            </span>

            <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label="Main">
              {NAV_ITEMS.map(({ path, id, label, icon: Icon }) => (
                <button
                  key={path}
                  id={id}
                  aria-label={label}
                  title={label}
                  onClick={() => onNavigate(path)}
                  aria-current={currentPath === path ? 'page' : undefined}
                  className={tabClass(currentPath === path)}
                >
                  <Icon className="h-4 w-4 text-emerald-400" />
                  <span className="hidden xl:inline">{label}</span>
                </button>
              ))}
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
                <span className="hidden xl:inline">Add Record</span>
              </button>
            )}

            {onSignOut && (
              <button
                id="btn-sign-out"
                onClick={onSignOut}
                title={userEmail ? `Signed in as ${userEmail}` : 'Sign out'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:border-white/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden max-w-[160px] truncate 2xl:inline">{userEmail || 'Sign out'}</span>
                <span className="sr-only">Sign out</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
