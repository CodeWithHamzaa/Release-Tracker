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
  Tag,
  ChevronDown,
} from 'lucide-react';
import { ReleaseRecord, ReleaseStatus } from '@/lib/types';
import { DEFAULT_DEVELOPER, developerOptions } from '@/lib/developers';

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
  const [status, setStatus] = useState<ReleaseStatus>('PENDING');
  const [version, setVersion] = useState('');
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
      const rawStatus = String(record.status || 'PENDING').trim().toUpperCase();
      const normalizedStatus: ReleaseStatus =
        rawStatus === 'SUCCESS' ? 'SUCCESS' : rawStatus === 'FAILED' ? 'FAILED' : 'PENDING';

      setStatus(normalizedStatus);
      setVersion(record.version || 'v1.0.0');
      // Falling back to the roster default keeps the <select> in a valid state;
      // an empty value would match no option and render as an unsaveable blank.
      setDeveloperName(record.developerName?.trim() || DEFAULT_DEVELOPER);
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
      status,
      version: version.trim() || 'v1.0.0',
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
        import.meta.env.VITE_API_SECRET_KEY ||
        'your-enterprise-release-api-secret';

      // Call the standardized PATCH /api/records/[id] endpoint
      const res = await fetch(`/api/records/${record.id}`, {
        method: 'PATCH',
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

      // PATCH responds with { success, record }, not the record directly
      // (see lib/app.ts) -- unwrap it the same way AddRecordForm unwraps
      // POST's { records: [...] }. Passing the wrapper straight through gave
      // onUpdateSuccess an object with no .id, so App.tsx's
      // prev.map((r) => r.id === updatedRecord.id ? updatedRecord : r) never
      // matched anything: the server saved the edit, but the open tab kept
      // showing the old value until a full reload.
      const resJson = await res.json();
      const updatedRecord: ReleaseRecord = resJson && resJson.record ? resJson.record : resJson;
      onUpdateSuccess(updatedRecord);
      onClose();
    } catch (err: any) {
      console.warn('API update failed, updating locally:', err);
      // Fallback local update for preview
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-xs transition-opacity animate-in fade-in duration-150">
      <div
        className="bg-[#111111] w-full max-w-xl rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-[#161618]">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Edit Release Record</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {record.server} / <span className="text-emerald-400 font-medium">{record.service}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs sm:text-sm text-rose-300 flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <div className="font-medium">{errorMsg}</div>
            </div>
          )}

          {/* 1. Status Selection - Uppercase standard */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
              Deployment Status *
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setStatus('PENDING')}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all ${
                  status === 'PENDING'
                    ? 'bg-amber-950/40 text-amber-300 border-amber-600 ring-2 ring-amber-500/20'
                    : 'bg-[#18181b] text-zinc-400 border-zinc-800 hover:bg-zinc-800/60'
                }`}
              >
                <Clock className="w-4 h-4 text-amber-400" />
                <span>PENDING</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('SUCCESS')}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all ${
                  status === 'SUCCESS'
                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-600 ring-2 ring-emerald-500/20'
                    : 'bg-[#18181b] text-zinc-400 border-zinc-800 hover:bg-zinc-800/60'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>SUCCESS</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('FAILED')}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all ${
                  status === 'FAILED'
                    ? 'bg-rose-950/40 text-rose-300 border-rose-600 ring-2 ring-rose-500/20'
                    : 'bg-[#18181b] text-zinc-400 border-zinc-800 hover:bg-zinc-800/60'
                }`}
              >
                <XCircle className="w-4 h-4 text-rose-400" />
                <span>FAILED</span>
              </button>
            </div>
          </div>

          {/* 2. Version & Developer Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                Version *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                  <Tag className="w-4 h-4 text-emerald-500" />
                </div>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="e.g. v1.0.2"
                  className="w-full pl-9 pr-3 py-2 bg-[#18181b] border border-zinc-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="select-edit-developer"
                className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5"
              >
                Developer Name *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                  <User className="w-4 h-4 text-emerald-500" />
                </div>
                {/* developerOptions keeps any off-roster name already on the
                    record, so opening the modal never silently rewrites it. */}
                <select
                  id="select-edit-developer"
                  value={developerName}
                  onChange={(e) => setDeveloperName(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-[#18181b] border border-zinc-800 rounded-xl text-sm text-white appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  required
                >
                  {developerOptions(developerName).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>
          </div>

          {/* 3. Environment & Service Target */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Environment</label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#18181b] border border-zinc-800 rounded-xl text-xs font-semibold text-white focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="SIT">SIT</option>
                <option value="UAT">UAT</option>
                <option value="Prod">Prod</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Server</label>
              <input
                type="text"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#18181b] border border-zinc-800 rounded-xl text-xs text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Service</label>
              <input
                type="text"
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#18181b] border border-zinc-800 rounded-xl text-xs text-white"
                required
              />
            </div>
          </div>

          {/* 4. Release Notes */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              Release Notes / Status Update Notes
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Deployment passed regression suite, ready for staging QA..."
              className="w-full px-3 py-2 bg-[#18181b] border border-zinc-800 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>

          {/* Advanced toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-zinc-400 hover:text-emerald-400 font-medium transition-colors"
            >
              {showAdvanced ? '− Hide technical details' : '+ Show technical flags (build, env, commands)'}
            </button>
          </div>

          {showAdvanced && (
            <div className="p-3.5 bg-[#18181b] rounded-xl border border-zinc-800 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="flex items-center space-x-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={isBuildUpdate}
                    onChange={(e) => setIsBuildUpdate(e.target.checked)}
                    className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                  />
                  <span>Build Update</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={isEnvUpdate}
                    onChange={(e) => setIsEnvUpdate(e.target.checked)}
                    className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                  />
                  <span>Env Update</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={isConfigUpdate}
                    onChange={(e) => setIsConfigUpdate(e.target.checked)}
                    className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                  />
                  <span>Config Update</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={hasCommands}
                    onChange={(e) => setHasCommands(e.target.checked)}
                    className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                  />
                  <span>Commands</span>
                </label>
              </div>

              {isEnvUpdate && (
                <textarea
                  rows={2}
                  value={envDetails}
                  onChange={(e) => setEnvDetails(e.target.value)}
                  placeholder="Env variables..."
                  className="w-full p-2 bg-black border border-zinc-700 rounded-lg text-xs font-mono text-amber-300"
                />
              )}

              {isConfigUpdate && (
                <textarea
                  rows={2}
                  value={configDetails}
                  onChange={(e) => setConfigDetails(e.target.value)}
                  placeholder="Config updates..."
                  className="w-full p-2 bg-black border border-zinc-700 rounded-lg text-xs font-mono text-indigo-300"
                />
              )}

              {hasCommands && (
                <textarea
                  rows={2}
                  value={commandDetails}
                  onChange={(e) => setCommandDetails(e.target.value)}
                  placeholder="Shell / deployment commands..."
                  className="w-full p-2 bg-black border border-zinc-700 rounded-lg text-xs font-mono text-emerald-400"
                />
              )}
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-3 border-t border-zinc-800 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl shadow-lg transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1.5" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
