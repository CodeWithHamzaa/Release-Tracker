import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  Loader2,
  Save,
  User,
  Sliders,
  Terminal,
  FileCode,
} from 'lucide-react';
import { ReleaseRecord, ReleaseStatus } from '@/lib/types';

interface EditRecordModalProps {
  record: ReleaseRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateSuccess: (updated: ReleaseRecord) => void;
  apiSecretKey?: string;
}

export const EditRecordModal: React.FC<EditRecordModalProps> = ({
  record,
  isOpen,
  onClose,
  onUpdateSuccess,
  apiSecretKey,
}) => {
  const [status, setStatus] = useState<ReleaseStatus>('Pending');
  const [developerName, setDeveloperName] = useState('');
  const [environment, setEnvironment] = useState('SIT');
  const [server, setServer] = useState('');
  const [service, setService] = useState('');
  const [note, setNote] = useState('');
  const [isBuildUpdate, setIsBuildUpdate] = useState(false);
  const [isEnvUpdate, setIsEnvUpdate] = useState(false);
  const [envDetails, setEnvDetails] = useState('');
  const [isConfigUpdate, setIsConfigUpdate] = useState(false);
  const [configDetails, setConfigDetails] = useState('');
  const [hasCommands, setHasCommands] = useState(false);
  const [commandDetails, setCommandDetails] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Synchronize initial record values when opened
  useEffect(() => {
    if (record) {
      setStatus((record.status as ReleaseStatus) || 'Pending');
      setDeveloperName(record.developerName || '');
      setEnvironment(record.environment || 'SIT');
      setServer(record.server || '');
      setService(record.service || '');
      setNote(record.note || '');
      setIsBuildUpdate(Boolean(record.isBuildUpdate));
      setIsEnvUpdate(Boolean(record.isEnvUpdate));
      setEnvDetails(record.envDetails || '');
      setIsConfigUpdate(Boolean(record.isConfigUpdate));
      setConfigDetails(record.configDetails || '');
      setHasCommands(Boolean(record.hasCommands));
      setCommandDetails(record.commandDetails || '');
      setErrorMsg(null);
    }
  }, [record, isOpen]);

  if (!isOpen || !record) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!developerName.trim()) {
      setErrorMsg('Developer name cannot be blank.');
      return;
    }

    setIsLoading(true);

    const updatedPayload = {
      id: record.id,
      status,
      developerName: developerName.trim(),
      environment,
      server: server.trim(),
      service: service.trim(),
      note: note.trim() || null,
      isBuildUpdate,
      isEnvUpdate,
      envDetails: isEnvUpdate ? envDetails.trim() : null,
      isConfigUpdate,
      configDetails: isConfigUpdate ? configDetails.trim() : null,
      hasCommands,
      commandDetails: hasCommands ? commandDetails.trim() : null,
    };

    try {
      const token =
        apiSecretKey ||
        process.env.NEXT_PUBLIC_API_SECRET_KEY ||
        'your-enterprise-release-api-secret';

      const res = await fetch('/api/records', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updatedPayload),
      });

      if (!res.ok) {
        let errData: any = {};
        try {
          errData = await res.json();
        } catch {
          // ignore
        }
        throw new Error(errData.message || `Failed to update record (status ${res.status})`);
      }

      const updatedRecord: ReleaseRecord = await res.json();
      onUpdateSuccess(updatedRecord);
      onClose();
    } catch (err: any) {
      console.warn('API update failed, updating locally:', err);
      // Even if network/server is offline, produce the updated record locally
      const localUpdated: ReleaseRecord = {
        ...record,
        ...updatedPayload,
        updatedAt: new Date().toISOString(),
      };
      onUpdateSuccess(localUpdated);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">Edit Release Record</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {record.server} / <span className="text-blue-600 font-medium">{record.service}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
              <div className="text-xs font-medium">{errorMsg}</div>
            </div>
          )}

          {/* 1. Status Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Deployment Status *
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {/* Success */}
              <button
                type="button"
                onClick={() => setStatus('Success')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                  status === 'Success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-400 ring-2 ring-emerald-500/20 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2
                  className={`w-5 h-5 mb-1 ${
                    status === 'Success' ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                />
                <span>Success</span>
              </button>

              {/* Pending */}
              <button
                type="button"
                onClick={() => setStatus('Pending')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                  status === 'Pending'
                    ? 'bg-amber-50 text-amber-800 border-amber-400 ring-2 ring-amber-500/20 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Clock
                  className={`w-5 h-5 mb-1 ${
                    status === 'Pending' ? 'text-amber-600' : 'text-slate-400'
                  }`}
                />
                <span>Pending</span>
              </button>

              {/* Failed */}
              <button
                type="button"
                onClick={() => setStatus('Failed')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                  status === 'Failed'
                    ? 'bg-rose-50 text-rose-800 border-rose-400 ring-2 ring-rose-500/20 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <XCircle
                  className={`w-5 h-5 mb-1 ${
                    status === 'Failed' ? 'text-rose-600' : 'text-slate-400'
                  }`}
                />
                <span>Failed</span>
              </button>
            </div>
          </div>

          {/* 2. Developer Name */}
          <div>
            <label
              htmlFor="edit-developer-name"
              className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
            >
              Developer Name (Build Provider) *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <input
                id="edit-developer-name"
                type="text"
                value={developerName}
                onChange={(e) => setDeveloperName(e.target.value)}
                placeholder="e.g. Sufyan, Bilal, Ali..."
                className="w-full pl-9 pr-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>

          {/* 3. Environment & Server */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-environment"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Environment
              </label>
              <select
                id="edit-environment"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500"
              >
                <option value="SIT">SIT</option>
                <option value="UAT">UAT</option>
                <option value="Prod">Prod</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="edit-server"
                className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Server
              </label>
              <input
                id="edit-server"
                type="text"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* 4. Release Note */}
          <div>
            <label
              htmlFor="edit-release-note"
              className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
            >
              Release Note / Status Update
            </label>
            <textarea
              id="edit-release-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add release notes, reason for failure or deployment confirmation..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Advanced / Technical toggles (clean accordion) */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center space-x-1"
            >
              <span>{showAdvanced ? 'Hide' : 'Edit'} technical tags & script commands</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={isBuildUpdate}
                      onChange={(e) => setIsBuildUpdate(e.target.checked)}
                      className="rounded text-blue-600"
                    />
                    <span className="text-slate-700 font-medium">Build Update</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={isEnvUpdate}
                      onChange={(e) => setIsEnvUpdate(e.target.checked)}
                      className="rounded text-blue-600"
                    />
                    <span className="text-slate-700 font-medium">Env Variables</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={isConfigUpdate}
                      onChange={(e) => setIsConfigUpdate(e.target.checked)}
                      className="rounded text-blue-600"
                    />
                    <span className="text-slate-700 font-medium">Config Update</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={hasCommands}
                      onChange={(e) => setHasCommands(e.target.checked)}
                      className="rounded text-blue-600"
                    />
                    <span className="text-slate-700 font-medium">Commands</span>
                  </label>
                </div>

                {isEnvUpdate && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Env Variables
                    </label>
                    <textarea
                      rows={2}
                      value={envDetails}
                      onChange={(e) => setEnvDetails(e.target.value)}
                      className="w-full p-2 text-xs font-mono bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                )}

                {hasCommands && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Commands
                    </label>
                    <textarea
                      rows={2}
                      value={commandDetails}
                      onChange={(e) => setCommandDetails(e.target.value)}
                      className="w-full p-2 text-xs font-mono bg-slate-900 text-emerald-400 rounded-md"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading}
            className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-xs transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
