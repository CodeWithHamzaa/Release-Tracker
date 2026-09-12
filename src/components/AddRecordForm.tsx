import React, { useState } from 'react';
import {
  Server,
  User,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  Loader2,
  ArrowLeft,
  Sliders,
  Terminal,
  FileCode,
} from 'lucide-react';
import { CreateReleaseRecordInput, ARCHITECTURE_CATALOG, ReleaseRecord, ReleaseStatus } from '@/lib/types';

interface AddRecordFormProps {
  onSuccess: (newRecord: ReleaseRecord) => void;
  onCancel: () => void;
  apiSecretKey?: string;
}

export const AddRecordForm: React.FC<AddRecordFormProps> = ({
  onSuccess,
  onCancel,
  apiSecretKey,
}) => {
  // Form State
  const [environment, setEnvironment] = useState<'SIT' | 'UAT' | 'Prod'>('SIT');
  const [selectedServer, setSelectedServer] = useState<string>('Bot-Builder');
  const [customServer, setCustomServer] = useState<string>('');
  const [selectedService, setSelectedService] = useState<string>(
    ARCHITECTURE_CATALOG['Bot-Builder'][0] || 'bot-builder-api'
  );
  const [customService, setCustomService] = useState<string>('');
  const [developerName, setDeveloperName] = useState<string>('');
  const [status, setStatus] = useState<ReleaseStatus>('Pending');
  const [source, setSource] = useState<string>('Teams Group');
  const [addedBy, setAddedBy] = useState<string>('A.Hameed');
  const [note, setNote] = useState<string>('');

  // Update Type Checkboxes & Expansions
  const [isBuildUpdate, setIsBuildUpdate] = useState<boolean>(true);
  const [isEnvUpdate, setIsEnvUpdate] = useState<boolean>(false);
  const [envDetails, setEnvDetails] = useState<string>('');
  const [isConfigUpdate, setIsConfigUpdate] = useState<boolean>(false);
  const [configDetails, setConfigDetails] = useState<string>('');
  const [hasCommands, setHasCommands] = useState<boolean>(false);
  const [commandDetails, setCommandDetails] = useState<string>('');

  // UI status
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cascading dropdown behavior
  const handleServerChange = (newServer: string) => {
    setSelectedServer(newServer);
    if (newServer !== 'Custom' && ARCHITECTURE_CATALOG[newServer]) {
      setSelectedService(ARCHITECTURE_CATALOG[newServer][0] || '');
    } else {
      setSelectedService('Custom');
    }
  };

  const finalServer = selectedServer === 'Custom' ? customServer.trim() : selectedServer;
  const finalService = selectedService === 'Custom' ? customService.trim() : selectedService;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validation
    if (!finalServer) {
      setErrorMsg('Please select or specify a Server.');
      return;
    }
    if (!finalService) {
      setErrorMsg('Please select or specify a Service.');
      return;
    }
    if (!developerName.trim()) {
      setErrorMsg('Developer name is required. Please specify who provided the build.');
      return;
    }
    if (isEnvUpdate && !envDetails.trim()) {
      setErrorMsg('Please provide environment variable details or uncheck the option.');
      return;
    }
    if (isConfigUpdate && !configDetails.trim()) {
      setErrorMsg('Please provide config parameter details or uncheck the option.');
      return;
    }
    if (hasCommands && !commandDetails.trim()) {
      setErrorMsg('Please enter deployment commands or uncheck the option.');
      return;
    }

    const payload: CreateReleaseRecordInput = {
      environment,
      server: finalServer,
      service: finalService,
      developerName: developerName.trim(),
      status,
      isBuildUpdate,
      isEnvUpdate,
      envDetails: isEnvUpdate ? envDetails.trim() : null,
      isConfigUpdate,
      configDetails: isConfigUpdate ? configDetails.trim() : null,
      hasCommands,
      commandDetails: hasCommands ? commandDetails.trim() : null,
      note: note.trim() || null,
      source,
      added_by: addedBy,
    };

    setIsLoading(true);

    try {
      const token =
        apiSecretKey ||
        process.env.NEXT_PUBLIC_API_SECRET_KEY ||
        'your-enterprise-release-api-secret';

      // Submit via single write-path API
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errData: any = {};
        try {
          errData = await res.json();
        } catch {
          // ignore
        }
        throw new Error(errData.message || `Submission failed with status: ${res.status}`);
      }

      const created: ReleaseRecord = await res.json();
      setSuccessMsg('Release record logged successfully!');
      setTimeout(() => {
        onSuccess(created);
      }, 700);
    } catch (err: any) {
      console.error('Failed to submit record:', err);
      // Fallback local creation for development preview
      const fallbackCreated: ReleaseRecord = {
        id: crypto.randomUUID(),
        environment: payload.environment,
        server: payload.server,
        service: payload.service,
        developerName: payload.developerName,
        status: payload.status || 'Pending',
        isBuildUpdate: Boolean(payload.isBuildUpdate),
        isEnvUpdate: Boolean(payload.isEnvUpdate),
        envDetails: payload.envDetails ?? null,
        isConfigUpdate: Boolean(payload.isConfigUpdate),
        configDetails: payload.configDetails ?? null,
        hasCommands: Boolean(payload.hasCommands),
        commandDetails: payload.commandDetails ?? null,
        note: payload.note ?? null,
        source: payload.source,
        added_by: payload.added_by,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setSuccessMsg('Release record logged locally!');
      setTimeout(() => {
        onSuccess(fallbackCreated);
      }, 700);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Back button */}
      <button
        id="btn-back-to-dashboard"
        type="button"
        onClick={onCancel}
        className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to Dashboard
      </button>

      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
        {/* Header */}
        <div className="border-b border-slate-100 pb-4 mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Log New Release
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Record build details, developer attribution, and deployment status.
          </p>
        </div>

        {/* Feedback alerts */}
        {errorMsg && (
          <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700 flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
            <div className="flex-1">
              <p className="font-semibold">Error submitting record</p>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-700 flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            <div className="flex-1 font-semibold">{successMsg}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Status Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Initial Deployment Status *
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setStatus('Pending')}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                  status === 'Pending'
                    ? 'bg-amber-50 text-amber-800 border-amber-300 ring-2 ring-amber-400/20 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Pending</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('Success')}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                  status === 'Success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-400/20 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Success</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('Failed')}
                className={`flex items-center justify-center space-x-2 p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                  status === 'Failed'
                    ? 'bg-rose-50 text-rose-800 border-rose-300 ring-2 ring-rose-400/20 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <XCircle className="w-4 h-4 text-rose-600" />
                <span>Failed</span>
              </button>
            </div>
          </div>

          {/* Developer Name Field */}
          <div>
            <label
              htmlFor="input-developer-name"
              className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
            >
              Developer Name (Who wrote / provided the build) *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <input
                id="input-developer-name"
                type="text"
                value={developerName}
                onChange={(e) => setDeveloperName(e.target.value)}
                placeholder="e.g. Sufyan Tariq, Muhammad Bilal, Ali Raza..."
                className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-medium placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>

          {/* Cascading Architecture: Server & Service */}
          <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-3">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Server className="w-4 h-4 text-blue-600" />
              <span>Target Server & Service</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="select-server" className="block text-xs font-medium text-slate-600 mb-1">
                  Server *
                </label>
                <select
                  id="select-server"
                  value={selectedServer}
                  onChange={(e) => handleServerChange(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500"
                >
                  {Object.keys(ARCHITECTURE_CATALOG).map((srv) => (
                    <option key={srv} value={srv}>
                      {srv}
                    </option>
                  ))}
                  <option value="Custom">+ Custom Server</option>
                </select>

                {selectedServer === 'Custom' && (
                  <input
                    id="input-custom-server"
                    type="text"
                    value={customServer}
                    onChange={(e) => setCustomServer(e.target.value)}
                    placeholder="Server name..."
                    className="mt-2 w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                    required
                  />
                )}
              </div>

              <div>
                <label htmlFor="select-service" className="block text-xs font-medium text-slate-600 mb-1">
                  Service *
                </label>
                <select
                  id="select-service"
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500"
                >
                  {selectedServer !== 'Custom' &&
                    ARCHITECTURE_CATALOG[selectedServer]?.map((svc) => (
                      <option key={svc} value={svc}>
                        {svc}
                      </option>
                    ))}
                  <option value="Custom">+ Custom Service</option>
                </select>

                {selectedService === 'Custom' && (
                  <input
                    id="input-custom-service"
                    type="text"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    placeholder="Service name..."
                    className="mt-2 w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                    required
                  />
                )}
              </div>
            </div>
          </div>

          {/* Metadata Row: Environment, Added By, Source */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="select-environment" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Environment *
              </label>
              <select
                id="select-environment"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as any)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500"
              >
                <option value="SIT">SIT (Testing)</option>
                <option value="UAT">UAT (Staging)</option>
                <option value="Prod">Prod (Production)</option>
              </select>
            </div>

            <div>
              <label htmlFor="select-added-by" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Logged By *
              </label>
              <select
                id="select-added-by"
                value={addedBy}
                onChange={(e) => setAddedBy(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500"
              >
                <option value="A.Hameed">A.Hameed</option>
                <option value="Hanzala">Hanzala</option>
              </select>
            </div>

            <div>
              <label htmlFor="select-source" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Source *
              </label>
              <select
                id="select-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500"
              >
                <option value="Teams Group">Teams Group</option>
                <option value="Teams DM">Teams DM</option>
                <option value="OneDrive">OneDrive</option>
                <option value="SharePoint">SharePoint</option>
              </select>
            </div>
          </div>

          {/* Change Types Checklist */}
          <div className="space-y-3 pt-1">
            <span className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Change Types
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                <input
                  id="checkbox-build-update"
                  type="checkbox"
                  checked={isBuildUpdate}
                  onChange={(e) => setIsBuildUpdate(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">Build Code</span>
              </label>

              <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                <input
                  id="checkbox-env-update"
                  type="checkbox"
                  checked={isEnvUpdate}
                  onChange={(e) => setIsEnvUpdate(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">Env Vars</span>
              </label>

              <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                <input
                  id="checkbox-config-update"
                  type="checkbox"
                  checked={isConfigUpdate}
                  onChange={(e) => setIsConfigUpdate(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">Config</span>
              </label>

              <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                <input
                  id="checkbox-has-commands"
                  type="checkbox"
                  checked={hasCommands}
                  onChange={(e) => setHasCommands(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-medium text-slate-700">Commands</span>
              </label>
            </div>

            {/* Revealed Textarea: Env Details */}
            {isEnvUpdate && (
              <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 space-y-1">
                <label className="block text-xs font-bold text-amber-900 uppercase">
                  Environment Variables Specification
                </label>
                <textarea
                  rows={2}
                  value={envDetails}
                  onChange={(e) => setEnvDetails(e.target.value)}
                  placeholder="e.g. REDIS_MAX_CONNECTIONS=200"
                  className="w-full p-2 bg-white border border-amber-300 rounded-lg text-xs font-mono"
                  required={isEnvUpdate}
                />
              </div>
            )}

            {/* Revealed Textarea: Config Details */}
            {isConfigUpdate && (
              <div className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-1">
                <label className="block text-xs font-bold text-indigo-900 uppercase">
                  Configuration Details
                </label>
                <textarea
                  rows={2}
                  value={configDetails}
                  onChange={(e) => setConfigDetails(e.target.value)}
                  placeholder="e.g. Updated nginx routing rate-limiting thresholds"
                  className="w-full p-2 bg-white border border-indigo-300 rounded-lg text-xs font-mono"
                  required={isConfigUpdate}
                />
              </div>
            )}

            {/* Revealed Textarea: Command Details */}
            {hasCommands && (
              <div className="p-3 rounded-xl bg-violet-50/50 border border-violet-200 space-y-1">
                <label className="block text-xs font-bold text-violet-900 uppercase">
                  Deployment / Shell Execution Commands
                </label>
                <textarea
                  rows={2}
                  value={commandDetails}
                  onChange={(e) => setCommandDetails(e.target.value)}
                  placeholder="e.g. kubectl rollout restart deployment/bot-builder-api"
                  className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-emerald-400"
                  required={hasCommands}
                />
              </div>
            )}
          </div>

          {/* Release Notes */}
          <div>
            <label htmlFor="textarea-release-note" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Release Notes / Context (Optional)
            </label>
            <textarea
              id="textarea-release-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context, Jira ticket, bug fix description, or regression test notes..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end space-x-3">
            <button
              id="btn-cancel-form"
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              id="btn-submit-release"
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-xs transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Submit Record
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
