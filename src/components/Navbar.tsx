import React from 'react';
import { Layers, Plus, ShieldCheck, Activity } from 'lucide-react';

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
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Brand */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => onNavigate('/')}>
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold tracking-tight text-slate-800">
                  Release Tracker
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  Enterprise
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Deployment & Change Audit Console
              </p>
            </div>
          </div>

          {/* Center / Status */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600">
              <span className={`w-2 h-2 rounded-full ${isRealtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{isRealtimeConnected ? 'Supabase Real-time Active' : 'Real-time Standby'}</span>
            </div>
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>Single Write-Path API</span>
            </div>
          </div>

          {/* Navigation Actions */}
          <div className="flex items-center space-x-3">
            {currentPath === '/add' ? (
              <button
                id="btn-nav-dashboard"
                onClick={() => onNavigate('/')}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <Activity className="w-4 h-4 mr-1.5 text-slate-600" />
                View Dashboard
              </button>
            ) : (
              <button
                id="btn-nav-add-record"
                onClick={() => onNavigate('/add')}
                className="inline-flex items-center px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
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
