export type ReleaseStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface ReleaseRecord {
  id: string;
  environment: string; // 'SIT' | 'UAT' | 'Prod'
  server: string; // e.g., 'Bot-Builder', 'Chat-Service'
  service: string; // e.g., 'bot-builder-api', 'websocket-server'
  version: string; // e.g., 'v1.0.2'
  developerName: string; // Developer who provided or wrote the build
  status: ReleaseStatus | string; // 'SUCCESS' | 'FAILED' | 'PENDING'
  isBuildUpdate: boolean;
  isEnvUpdate: boolean;
  envDetails?: string | null;
  isConfigUpdate: boolean;
  configDetails?: string | null;
  hasCommands: boolean;
  commandDetails?: string | null;
  note?: string | null;
  source?: string; // 'Teams DM' | 'Teams Group' | 'OneDrive' | 'SharePoint' | 'Direct'
  added_by: string; // 'A.Hameed' | 'Hanzala' | 'Hameed'
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CreateReleaseRecordInput {
  environment: string;
  server: string;
  service: string;
  version: string;
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
  source?: string;
  added_by: string;
}

export interface UpdateReleaseRecordInput {
  version?: string;
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

export interface BatchServiceInput {
  server: string;
  service: string;
  version: string;
  developerName?: string;
  status?: ReleaseStatus | string;
  isBuildUpdate?: boolean;
}

export interface CreateBatchReleaseInput {
  environment: string;
  added_by: string;
  developerName?: string;
  source?: string;
  status?: ReleaseStatus | string;
  isBuildUpdate?: boolean;
  isEnvUpdate?: boolean;
  envDetails?: string | null;
  isConfigUpdate?: boolean;
  configDetails?: string | null;
  hasCommands?: boolean;
  commandDetails?: string | null;
  note?: string | null;
  services: BatchServiceInput[];
}

export const ARCHITECTURE_CATALOG: Record<string, string[]> = {
  'Bot-Builder': [
    'ldap-connector',
    'rbac-service',
    'nginx',
    'media-service',
    'omni-channel-nodejs',
    'single-intent',
    'alara-ui',
    'mcpherson-ui',
    'bot_builder_fbl_service',
    'elasticsearch',
    'elastic-search-service',
    'minio',
  ],
  'ChatBot / NLU': [
    'retriever_api_service',
    'common-service',
    'litellm-service',
    'litellm-db',
  ],
  'Database': [
    'redis-db',
    'mongo-db',
    'kafka',
    'qdrant',
    'mysql-db',
  ],
  'Chat-Service': [
    'chat-service',
    'chat-service-worker',
  ],
};
