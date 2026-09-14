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
  Tag,
  Sliders,
  Terminal,
  FileCode,
  Plus,
  Trash2,
  Copy,
  Layers,
  Box,
  Hash,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { ReleaseRecord, ReleaseStatus } from '@/lib/types';
import servicesConfig from '@/config/services.json';

const ARCHITECTURE_SERVICES: Record<string, string[]> = servicesConfig;

export interface ServiceFormBlock {
  id: string;
  server: string;
  customServer: string;
  service: string;
  customService: string;
  version: string;
  developerName: string;
}

interface AddRecordFormProps {
  onSuccess: (newRecords: ReleaseRecord | ReleaseRecord[]) => void;
  onCancel: () => void;
  apiSecretKey?: string;
}

export const AddRecordForm: React.FC<AddRecordFormProps> = ({
  onSuccess,
  onCancel,
  apiSecretKey,
}) => {
  const availableServers = Object.keys(ARCHITECTURE_SERVICES);
  const defaultServer = availableServers[0] || 'Bot-Builder';
  const defaultServices = ARCHITECTURE_SERVICES[defaultServer] || [];

  // Global Batch State (Top)
  const [environment, setEnvironment] = useState<'SIT' | 'UAT' | 'Prod'>('SIT');
  const [status, setStatus] = useState<ReleaseStatus>('PENDING');
  const [addedBy, setAddedBy] = useState<string>('A.Hameed');
  const [globalDeveloperName, setGlobalDeveloperName] = useState<string>('Sufyan Tariq');
  const [note, setNote] = useState<string>('');

  // Dynamic Services Array (Middle)
  const [servicesList, setServicesList] = useState<ServiceFormBlock[]>([
    {
      id: crypto.randomUUID(),
      server: defaultServer,
      customServer: '',
      service: defaultServices[0] || 'ldap-connector',
      customService: '',
      version: 'v1.0.0',
      developerName: '',
    },
  ]);

  // Toggles: Config Changes and Scripts/Commands (Bottom)
  const [isBuildUpdate, setIsBuildUpdate] = useState<boolean>(true);
  const [isEnvUpdate, setIsEnvUpdate] = useState<boolean>(false);
  const [envDetails, setEnvDetails] = useState<string>('');
  const [isConfigUpdate, setIsConfigUpdate] = useState<boolean>(false);
  const [configDetails, setConfigDetails] = useState<string>('');
  const [hasCommands, setHasCommands] = useState<boolean>(false);
  const [commandDetails, setCommandDetails] = useState<string>('');

  // Submission Status
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add new service block to batch
  const handleAddServiceBlock = () => {
    // Pick the server from the previous item or default to first
    const lastItem = servicesList[servicesList.length - 1];
    const initialServer = lastItem ? lastItem.server : defaultServer;
    const servicesForServer = ARCHITECTURE_SERVICES[initialServer] || defaultServices;
    const initialService = servicesForServer[0] || '';

    const newBlock: ServiceFormBlock = {
      id: crypto.randomUUID(),
      server: initialServer,
      customServer: '',
      service: initialService,
      customService: '',
      version: lastItem ? lastItem.version : 'v1.0.0',
      developerName: '',
    };

    setServicesList((prev) => [...prev, newBlock]);
  };

  // Duplicate an existing service block
  const handleDuplicateServiceBlock = (index: number) => {
    const target = servicesList[index];
    if (!target) return;

    const cloned: ServiceFormBlock = {
      ...target,
      id: crypto.randomUUID(),
      // Try next available service under same server if possible
      service: target.service,
    };

    const nextList = [...servicesList];
    nextList.splice(index + 1, 0, cloned);
    setServicesList(nextList);
  };

  // Remove a service block
  const handleRemoveServiceBlock = (id: string) => {
    if (servicesList.length <= 1) return;
    setServicesList((prev) => prev.filter((item) => item.id !== id));
  };

  // Update a field in a specific block
  const handleUpdateBlockField = (
    id: string,
    field: keyof ServiceFormBlock,
    value: string
  ) => {
    setServicesList((prev) =>
      prev.map((block) => {
        if (block.id !== id) return block;

        // If server is updated, automatically populate service dropdown with first service
        if (field === 'server') {
          const newServer = value;
          let newService = '';
          if (newServer !== 'Custom' && ARCHITECTURE_SERVICES[newServer]) {
            newService = ARCHITECTURE_SERVICES[newServer][0] || '';
          } else {
            newService = 'Custom';
          }
          return {
            ...block,
            server: newServer,
            service: newService,
          };
        }

        return { ...block, [field]: value };
      })
    );
  };

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // 1. Validate Services Array
    if (servicesList.length === 0) {
      setErrorMsg('Please add at least one service to the deployment batch.');
      return;
    }

    const validatedServices: Array<{
      server: string;
      service: string;
      version: string;
      developerName: string;
    }> = [];

    for (let i = 0; i < servicesList.length; i++) {
      const block = servicesList[i];
      const finalServer =
        block.server === 'Custom' ? block.customServer.trim() : block.server.trim();
      const finalService =
        block.service === 'Custom' ? block.customService.trim() : block.service.trim();
      const finalVersion = block.version.trim();
      const devName = (
        block.developerName.trim() ||
        globalDeveloperName.trim() ||
        addedBy
      ).trim();

      if (!finalServer) {
        setErrorMsg(`Service #${i + 1} is missing a valid Server selection.`);
        return;
      }
      if (!finalService) {
        setErrorMsg(`Service #${i + 1} is missing a valid Target Service name.`);
        return;
      }
      if (!finalVersion) {
        setErrorMsg(
          `Service #${i + 1} (${finalService}) requires a Version / Docker Image Tag (e.g. v1.0.2).`
        );
        return;
      }

      validatedServices.push({
        server: finalServer,
        service: finalService,
        version: finalVersion,
        developerName: devName,
      });
    }

    // 2. Validate toggles
    if (isEnvUpdate && !envDetails.trim()) {
      setErrorMsg('Please specify the Environment Variables or uncheck the toggle.');
      return;
    }
    if (isConfigUpdate && !configDetails.trim()) {
      setErrorMsg('Please specify Configuration Details or uncheck the toggle.');
      return;
    }
    if (hasCommands && !commandDetails.trim()) {
      setErrorMsg('Please specify Deployment Execution Commands or uncheck the toggle.');
      return;
    }

    // Construct Batch Payload
    const batchPayload = {
      environment,
      added_by: addedBy,
      developerName: globalDeveloperName.trim() || addedBy,
      status,
      isBuildUpdate,
      isEnvUpdate,
      envDetails: isEnvUpdate ? envDetails.trim() : null,
      isConfigUpdate,
      configDetails: isConfigUpdate ? configDetails.trim() : null,
      hasCommands,
      commandDetails: hasCommands ? commandDetails.trim() : null,
      note: note.trim() || null,
      services: validatedServices,
    };

    setIsLoading(true);

    try {
      const token =
        apiSecretKey ||
        process.env.NEXT_PUBLIC_API_SECRET_KEY ||
        'your-enterprise-release-api-secret';

      const res = await fetch('/api/records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(batchPayload),
      });

      if (!res.ok) {
        let errData: any = {};
        try {
          errData = await res.json();
        } catch {
          // ignore
        }
        throw new Error(
          errData.message || `API submission failed with status code ${res.status}`
        );
      }

      const resJson = await res.json();
      const createdList: ReleaseRecord[] =
        resJson.records && Array.isArray(resJson.records)
          ? resJson.records
          : Array.isArray(resJson)
          ? resJson
          : [resJson];

      setSuccessMsg(
        `Batch release recorded successfully! (${createdList.length} services deployed to ${environment})`
      );

      setTimeout(() => {
        onSuccess(createdList);
      }, 700);
    } catch (err: any) {
      console.warn('API route fallback or error during batch submission:', err);

      // Local fallback generation for offline / development
      const sharedTime = new Date().toISOString();
      const fallbackList: ReleaseRecord[] = validatedServices.map((s) => ({
        id: crypto.randomUUID(),
        environment,
        server: s.server,
        service: s.service,
        version: s.version,
        developerName: s.developerName,
        status,
        isBuildUpdate,
        isEnvUpdate,
        envDetails: isEnvUpdate ? envDetails.trim() : null,
        isConfigUpdate,
        configDetails: isConfigUpdate ? configDetails.trim() : null,
        hasCommands,
        commandDetails: hasCommands ? commandDetails.trim() : null,
        note: note.trim() || null,
        added_by: addedBy,
        createdAt: sharedTime,
        updatedAt: sharedTime,
      }));

      setSuccessMsg(
        `Batch release logged locally! (${fallbackList.length} services staged for ${environment})`
      );

      setTimeout(() => {
        onSuccess(fallbackList);
      }, 700);
    } finally {
      setIsLoading(false);
    }
  };

  // Grouping stats for the summary badge
  const serverCounts = servicesList.reduce((acc, curr) => {
    const srv = curr.server === 'Custom' ? curr.customServer || 'Custom' : curr.server;
    acc[srv] = (acc[srv] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Return Navigation */}
      <button
        id="btn-back-to-dashboard"
        type="button"
        onClick={onCancel}
        className="inline-flex items-center text-sm font-medium text-zinc-400 hover:text-emerald-400 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Dashboard
      </button>

      <div className="bg-[#111111] rounded-2xl border border-zinc-800/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 sm:p-8 border-b border-zinc-800/80 bg-[#121214]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="w-11 h-11 rounded-xl bg-emerald-950/70 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-md">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    New Batch Deployment
                  </h1>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-800/60">
                    Multi-Service
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Deploy multiple services across servers simultaneously into a single environment batch.
                </p>
              </div>
            </div>

            {/* Live Count Pill */}
            <div className="flex items-center space-x-2 bg-[#18181b] px-3.5 py-1.5 rounded-xl border border-zinc-800 text-xs text-zinc-300 self-start sm:self-auto">
              <Box className="w-4 h-4 text-emerald-400" />
              <span>
                <strong className="text-white">{servicesList.length}</strong>{' '}
                {servicesList.length === 1 ? 'Service' : 'Services'} in Batch
              </span>
            </div>
          </div>
        </div>

        {/* Feedback Alerts */}
        {errorMsg && (
          <div className="mx-6 sm:mx-8 mt-6 p-4 rounded-xl bg-rose-950/40 border border-rose-800/70 text-xs sm:text-sm text-rose-300 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
            <div className="flex-1">
              <p className="font-semibold text-rose-200">Validation / Submission Error</p>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 sm:mx-8 mt-6 p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/70 text-xs sm:text-sm text-emerald-300 flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-400" />
            <div className="flex-1 font-semibold">{successMsg}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-8">
          {/* ========================================================================= */}
          {/* 1. GLOBAL BATCH INFO (TOP) */}
          {/* ========================================================================= */}
          <div className="space-y-5">
            <div className="flex items-center space-x-2 text-xs font-bold text-zinc-400 uppercase tracking-wider pb-2 border-b border-zinc-800/60">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <span>1. Global Batch Environment & Attributes</span>
            </div>

            {/* Status Selection - Strict Uppercase Standard */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                Batch Deployment Status *
              </label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  id="btn-status-pending"
                  onClick={() => setStatus('PENDING')}
                  className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border text-xs sm:text-sm font-semibold transition-all ${
                    status === 'PENDING'
                      ? 'bg-amber-950/40 text-amber-300 border-amber-600/70 ring-2 ring-amber-500/20 shadow-lg'
                      : 'bg-[#18181b] text-zinc-400 border-zinc-800 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>PENDING</span>
                </button>

                <button
                  type="button"
                  id="btn-status-success"
                  onClick={() => setStatus('SUCCESS')}
                  className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border text-xs sm:text-sm font-semibold transition-all ${
                    status === 'SUCCESS'
                      ? 'bg-emerald-950/40 text-emerald-300 border-emerald-600/70 ring-2 ring-emerald-500/20 shadow-lg'
                      : 'bg-[#18181b] text-zinc-400 border-zinc-800 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>SUCCESS</span>
                </button>

                <button
                  type="button"
                  id="btn-status-failed"
                  onClick={() => setStatus('FAILED')}
                  className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border text-xs sm:text-sm font-semibold transition-all ${
                    status === 'FAILED'
                      ? 'bg-rose-950/40 text-rose-300 border-rose-600/70 ring-2 ring-rose-500/20 shadow-lg'
                      : 'bg-[#18181b] text-zinc-400 border-zinc-800 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <XCircle className="w-4 h-4 text-rose-400" />
                  <span>FAILED</span>
                </button>
              </div>
            </div>

            {/* Target Environment & Logged By Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="select-environment"
                  className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2"
                >
                  Target Environment *
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#18181b] rounded-xl border border-zinc-800">
                  {(['SIT', 'UAT', 'Prod'] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setEnvironment(env)}
                      className={`py-2 text-xs font-bold rounded-lg transition-all ${
                        environment === env
                          ? env === 'Prod'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : env === 'UAT'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'bg-amber-600 text-white shadow-md'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="select-added-by"
                  className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2"
                >
                  Deployed / Logged By *
                </label>
                <select
                  id="select-added-by"
                  value={addedBy}
                  onChange={(e) => setAddedBy(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#18181b] border border-zinc-800 rounded-xl text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                >
                  <option value="A.Hameed">A.Hameed</option>
                  <option value="Hanzala">Hanzala</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="input-default-developer"
                  className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2"
                >
                  Lead Developer / Author *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                    <User className="w-4 h-4 text-emerald-500" />
                  </div>
                  <input
                    id="input-default-developer"
                    type="text"
                    value={globalDeveloperName}
                    onChange={(e) => setGlobalDeveloperName(e.target.value)}
                    placeholder="e.g. Sufyan Tariq"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-[#18181b] border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 2. DYNAMIC SERVICES ARRAY (MIDDLE) */}
          {/* ========================================================================= */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
              <div className="flex items-center space-x-2">
                <Box className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  2. Services Included in This Batch
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300">
                  {servicesList.length}
                </span>
              </div>

              <button
                id="btn-add-service-top"
                type="button"
                onClick={handleAddServiceBlock}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-950/70 border border-emerald-600/40 rounded-lg transition-all"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Service
              </button>
            </div>

            {/* Repeatable Blocks */}
            <div className="space-y-3.5">
              {servicesList.map((block, index) => {
                const currentServerServices =
                  block.server !== 'Custom' && ARCHITECTURE_SERVICES[block.server]
                    ? ARCHITECTURE_SERVICES[block.server]
                    : [];

                return (
                  <div
                    key={block.id}
                    className="p-4 sm:p-5 rounded-xl bg-[#161618] border border-zinc-800/90 shadow-sm relative group hover:border-zinc-700/80 transition-all"
                  >
                    {/* Block Title & Action Controls */}
                    <div className="flex items-center justify-between mb-3.5 pb-2.5 border-b border-zinc-800/60">
                      <div className="flex items-center space-x-2.5">
                        <span className="w-6 h-6 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center justify-center">
                          {index + 1}
                        </span>
                        <span className="text-sm font-semibold text-white">
                          Service Block #{index + 1}
                        </span>
                        {block.server && (
                          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-400 font-mono">
                            {block.server}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Duplicate Button */}
                        <button
                          type="button"
                          onClick={() => handleDuplicateServiceBlock(index)}
                          title="Duplicate this service block"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        {/* Remove Button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveServiceBlock(block.id)}
                          disabled={servicesList.length <= 1}
                          title={
                            servicesList.length <= 1
                              ? 'Batch must contain at least one service'
                              : 'Remove this service from batch'
                          }
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Inputs Row: Server, Service, Version */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                      {/* Server Selector */}
                      <div className="sm:col-span-4">
                        <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                          Server *
                        </label>
                        <select
                          value={block.server}
                          onChange={(e) =>
                            handleUpdateBlockField(block.id, 'server', e.target.value)
                          }
                          className="w-full px-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                        >
                          {availableServers.map((srv) => (
                            <option key={srv} value={srv}>
                              {srv}
                            </option>
                          ))}
                          <option value="Custom">+ Custom Server</option>
                        </select>

                        {block.server === 'Custom' && (
                          <input
                            type="text"
                            value={block.customServer}
                            onChange={(e) =>
                              handleUpdateBlockField(
                                block.id,
                                'customServer',
                                e.target.value
                              )
                            }
                            placeholder="Enter custom server name..."
                            className="mt-2 w-full px-3 py-1.5 bg-[#1f1f23] border border-zinc-700/80 rounded-lg text-xs text-white"
                            required
                          />
                        )}
                      </div>

                      {/* Service Selector (Dynamically populated) */}
                      <div className="sm:col-span-4">
                        <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                          Target Service *
                        </label>
                        <select
                          value={block.service}
                          onChange={(e) =>
                            handleUpdateBlockField(block.id, 'service', e.target.value)
                          }
                          className="w-full px-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                        >
                          {currentServerServices.map((svc) => (
                            <option key={svc} value={svc}>
                              {svc}
                            </option>
                          ))}
                          <option value="Custom">+ Custom Service</option>
                        </select>

                        {block.service === 'Custom' && (
                          <input
                            type="text"
                            value={block.customService}
                            onChange={(e) =>
                              handleUpdateBlockField(
                                block.id,
                                'customService',
                                e.target.value
                              )
                            }
                            placeholder="Enter custom service name..."
                            className="mt-2 w-full px-3 py-1.5 bg-[#1f1f23] border border-zinc-700/80 rounded-lg text-xs text-white"
                            required
                          />
                        )}
                      </div>

                      {/* Version / Docker Image Tag */}
                      <div className="sm:col-span-4">
                        <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                          Version / Docker Image Tag *
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                            <Tag className="w-3.5 h-3.5 text-emerald-500" />
                          </div>
                          <input
                            type="text"
                            value={block.version}
                            onChange={(e) =>
                              handleUpdateBlockField(block.id, 'version', e.target.value)
                            }
                            placeholder="e.g. v1.0.2 or sha-9a1f2"
                            className="w-full pl-9 pr-3 py-2 bg-[#1f1f23] border border-zinc-700/80 rounded-xl text-sm font-mono text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* "+ Add Service to Batch" Primary Button */}
            <button
              id="btn-add-service-bottom"
              type="button"
              onClick={handleAddServiceBlock}
              className="w-full py-3.5 border-2 border-dashed border-zinc-800 hover:border-emerald-500/60 rounded-xl flex items-center justify-center space-x-2 text-sm font-semibold text-zinc-400 hover:text-emerald-400 hover:bg-emerald-950/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add Service to Batch</span>
            </button>
          </div>

          {/* ========================================================================= */}
          {/* 3. TOGGLES: CONFIG CHANGES & SCRIPTS/COMMANDS (BOTTOM) */}
          {/* ========================================================================= */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-zinc-400 uppercase tracking-wider pb-2 border-b border-zinc-800/60">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>3. Change Details, Configs & Deployment Commands</span>
            </div>

            {/* Checkbox Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <label className="flex items-center space-x-2.5 p-3 rounded-xl border border-zinc-800 bg-[#18181b] hover:bg-zinc-800/50 cursor-pointer transition-colors">
                <input
                  id="checkbox-build-update"
                  type="checkbox"
                  checked={isBuildUpdate}
                  onChange={(e) => setIsBuildUpdate(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                />
                <span className="text-xs font-semibold text-zinc-200">Build Image</span>
              </label>

              <label className="flex items-center space-x-2.5 p-3 rounded-xl border border-zinc-800 bg-[#18181b] hover:bg-zinc-800/50 cursor-pointer transition-colors">
                <input
                  id="checkbox-env-update"
                  type="checkbox"
                  checked={isEnvUpdate}
                  onChange={(e) => setIsEnvUpdate(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                />
                <span className="text-xs font-semibold text-zinc-200">Env Variables</span>
              </label>

              <label className="flex items-center space-x-2.5 p-3 rounded-xl border border-zinc-800 bg-[#18181b] hover:bg-zinc-800/50 cursor-pointer transition-colors">
                <input
                  id="checkbox-config-update"
                  type="checkbox"
                  checked={isConfigUpdate}
                  onChange={(e) => setIsConfigUpdate(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                />
                <span className="text-xs font-semibold text-zinc-200">Config Changes</span>
              </label>

              <label className="flex items-center space-x-2.5 p-3 rounded-xl border border-zinc-800 bg-[#18181b] hover:bg-zinc-800/50 cursor-pointer transition-colors">
                <input
                  id="checkbox-has-commands"
                  type="checkbox"
                  checked={hasCommands}
                  onChange={(e) => setHasCommands(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-emerald-500 bg-zinc-900 border-zinc-700"
                />
                <span className="text-xs font-semibold text-zinc-200">Execution Scripts</span>
              </label>
            </div>

            {/* Revealed: Env Details */}
            {isEnvUpdate && (
              <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 space-y-2">
                <label className="block text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Environment Variables Specification
                </label>
                <textarea
                  rows={3}
                  value={envDetails}
                  onChange={(e) => setEnvDetails(e.target.value)}
                  placeholder="e.g. REDIS_CLUSTER_URL=rediss://prod-cache.internal:6379&#10;BOT_MAX_CONCURRENCY=250"
                  className="w-full p-3 bg-[#121214] border border-amber-800/60 rounded-lg text-xs font-mono text-amber-200 placeholder-amber-700/60 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  required={isEnvUpdate}
                />
              </div>
            )}

            {/* Revealed: Config Details */}
            {isConfigUpdate && (
              <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-800/40 space-y-2">
                <label className="block text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  Configuration Changes
                </label>
                <textarea
                  rows={3}
                  value={configDetails}
                  onChange={(e) => setConfigDetails(e.target.value)}
                  placeholder="e.g. Updated timeout thresholds in config/routing.json from 15s to 8s; enabled heartbeat interval 25s."
                  className="w-full p-3 bg-[#121214] border border-indigo-800/60 rounded-lg text-xs font-mono text-indigo-200 placeholder-indigo-700/60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required={isConfigUpdate}
                />
              </div>
            )}

            {/* Revealed: Deployment Commands / Scripts */}
            {hasCommands && (
              <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    Deployment / Shell Execution Commands
                  </label>
                  <span className="text-xs text-zinc-500 font-mono">bash / docker</span>
                </div>
                <textarea
                  rows={3}
                  value={commandDetails}
                  onChange={(e) => setCommandDetails(e.target.value)}
                  placeholder="e.g. docker compose -f docker-compose.sit.yml up -d --force-recreate&#10;kubectl rollout restart deployment/bot-builder-api -n sit"
                  className="w-full p-3 bg-black border border-zinc-800 rounded-lg text-xs font-mono text-emerald-400 placeholder-emerald-900/60 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required={hasCommands}
                />
              </div>
            )}

            {/* Global Release Notes */}
            <div>
              <label
                htmlFor="textarea-batch-note"
                className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2"
              >
                Global Release Notes / Context (Optional)
              </label>
              <textarea
                id="textarea-batch-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Describe reason for deployment, sprint context, Jira tickets, bug fixes, or post-deploy verification notes..."
                className="w-full px-3.5 py-2.5 bg-[#18181b] border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
              />
            </div>
          </div>

          {/* ========================================================================= */}
          {/* BATCH SUMMARY BAR & ACTIONS */}
          {/* ========================================================================= */}
          <div className="pt-6 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Summary details */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-semibold text-zinc-300">Ready to deploy:</span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-bold border border-emerald-800/60">
                {environment}
              </span>
              <span>•</span>
              <span>{servicesList.length} service(s)</span>
              <span>•</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(serverCounts).map(([srv, count]) => (
                  <span
                    key={srv}
                    className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-xs font-mono"
                  >
                    {srv}: {count}
                  </span>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
              <button
                id="btn-cancel-form"
                type="button"
                onClick={onCancel}
                className="px-5 py-2.5 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                id="btn-submit-batch"
                type="submit"
                disabled={isLoading}
                className="inline-flex items-center justify-center px-6 py-2.5 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl shadow-lg shadow-emerald-950/40 transition-all"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deploying Batch...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Deploy Batch ({servicesList.length} {servicesList.length === 1 ? 'Service' : 'Services'})
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
