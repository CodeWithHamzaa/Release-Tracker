import React from 'react';
import { Layers, Plus, Activity } from 'lucide-react';

interface NavbarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isRealtimeConnected?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentPath,
  onNavigate,
  isRealtimeConnected = false,
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
            <span className="text-sm font-semibold tracking-tight text-white">
              Release Tracker
            </span>
          </button>

          {/* Realtime indicator + actions */}
          <div className="flex items-center gap-3">
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

            {currentPath === '/add' ? (
              <button
                id="btn-nav-dashboard"
                onClick={() => onNavigate('/')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <Activity className="h-4 w-4 text-emerald-400" />
                Dashboard
              </button>
            ) : (
              <button
                id="btn-nav-add-record"
                onClick={() => onNavigate('/add')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                <Plus className="h-4 w-4" />
                Add Record
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
