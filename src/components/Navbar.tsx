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
}) => {
  return (
    <header className="sticky top-0 z-30 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-zinc-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Brand */}
          <div
            className="flex items-center space-x-3 cursor-pointer group"
            onClick={() => onNavigate('/')}
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-sm group-hover:border-emerald-400 transition-colors">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold tracking-tight text-white group-hover:text-emerald-400 transition-colors">
                  Release Tracker
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                  Enterprise
                </span>
              </div>
              <p className="text-xs text-zinc-400 hidden sm:block">
                Deployment & Change Audit Console
              </p>
            </div>
          </div>

          {/* Navigation Actions */}
          <div className="flex items-center space-x-3">
            {currentPath === '/add' ? (
              <button
                id="btn-nav-dashboard"
                onClick={() => onNavigate('/')}
                className="inline-flex items-center px-4 py-2 text-sm font-semibold text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 rounded-xl transition-colors border border-zinc-700/60"
              >
                <Activity className="w-4 h-4 mr-1.5 text-emerald-400" />
                View Dashboard
              </button>
            ) : (
              <button
                id="btn-nav-add-record"
                onClick={() => onNavigate('/add')}
                className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-lg shadow-emerald-950/40 transition-all"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add New Record
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
