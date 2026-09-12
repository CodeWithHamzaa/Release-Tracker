export type ReleaseStatus = 'Success' | 'Failed' | 'Pending';

export interface ReleaseRecord {
  id: string;
  environment: string; // 'SIT' | 'UAT' | 'Prod'
  server: string; // e.g., 'Bot-Builder', 'Chat-Service'
  service: string; // e.g., 'bot-builder-api', 'websocket-server'
  developerName: string; // Developer who provided or wrote the build
  status: ReleaseStatus | string; // 'Success' | 'Failed' | 'Pending'
  isBuildUpdate: boolean;
  isEnvUpdate: boolean;
  envDetails?: string | null;
  isConfigUpdate: boolean;
  configDetails?: string | null;
  hasCommands: boolean;
  commandDetails?: string | null;
  note?: string | null;
  source: string; // 'Teams DM' | 'Teams Group' | 'OneDrive' | 'SharePoint'
  added_by: string; // 'A.Hameed' | 'Hanzala' | 'Hameed'
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CreateReleaseRecordInput {
  environment: string;
  server: string;
  service: string;
  developerName: string;
  status?: ReleaseStatus | string;
  isBuildUpdate?: boolean;
  isEnvUpdate?: boolean;
  envDetails?: string | null;
  isConfigUpdate?: boolean;
  configDetails?: string | null;
  hasCommands?: boolean;
  commandDetails?: string | null;
  note?: string | null;
  source: string;
  added_by: string;
}

export interface UpdateReleaseRecordInput {
  status?: ReleaseStatus | string;
  developerName?: string;
  note?: string | null;
  environment?: string;
  server?: string;
  service?: string;
  isBuildUpdate?: boolean;
  isEnvUpdate?: boolean;
  envDetails?: string | null;
  isConfigUpdate?: boolean;
  configDetails?: string | null;
  hasCommands?: boolean;
  commandDetails?: string | null;
  source?: string;
  added_by?: string;
}

export const ARCHITECTURE_CATALOG: Record<string, string[]> = {
  'Bot-Builder': [
    'bot-builder-api',
    'bot-flow-engine',
    'bot-analytics-worker',
    'redis-cache',
    'bot-admin-portal',
  ],
  'Chat-Service': [
    'websocket-server',
    'chat-router-service',
    'message-store',
    'presence-monitor',
    'attachment-handler',
  ],
  'Auth-Gateway': [
    'oauth-provider',
    'session-manager',
    'token-validator',
    'mfa-authenticator',
  ],
  'Integration-Hub': [
    'teams-webhook-handler',
    'sharepoint-sync',
    'notification-dispatch',
    'email-service',
  ],
  'Analytics-Engine': [
    'event-collector',
    'metric-aggregator',
    'report-generator',
    'audit-logger',
  ],
  'Core-Backend': [
    'main-api-service',
    'cron-scheduler',
    'db-migration-runner',
    'file-storage-broker',
  ],
};
