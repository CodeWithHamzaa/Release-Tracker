import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/prisma';
import { ReleaseRecord, ReleaseStatus } from '@/lib/types';

// In-memory fallback store for preview and local development when Prisma/DB is pending
export const fallbackRecords: ReleaseRecord[] = [
  {
    id: 'rel-101',
    environment: 'Prod',
    server: 'Bot-Builder',
    service: 'bot-builder-api',
    version: 'v2.4.1',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'REDIS_CLUSTER_URL updated to production primary node\nBOT_MAX_CONCURRENCY=250',
    isConfigUpdate: true,
    configDetails: 'Updated timeout thresholds in config/routing.json from 15s to 8s.',
    hasCommands: true,
    commandDetails: 'kubectl rollout restart deployment/bot-builder-api -n production',
    note: 'Hotfix release addressing connection pooling during peak hours.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 'rel-102',
    environment: 'UAT',
    server: 'Chat-Service',
    service: 'websocket-server',
    version: 'v2.4.0',
    developerName: 'Muhammad Bilal',
    status: 'PENDING',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Enabled heartbeat ping interval 25s for mobile clients.',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for regression testing before Friday cutover.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: 'rel-103',
    environment: 'SIT',
    server: 'Bot-Builder',
    service: 'ldap-connector',
    version: 'v1.2.0',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d ldap-connector',
    note: 'Batch update: LDAP directory sync optimization.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'rel-104',
    environment: 'SIT',
    server: 'Database',
    service: 'redis-db',
    version: '7.2-alpine',
    developerName: 'Ali Raza',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'REDIS_MAX_MEMORY=4gb\nMAXMEMORY_POLICY=allkeys-lru',
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d redis-db',
    note: 'Upgraded cache container image tag in SIT batch deployment.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'rel-105',
    environment: 'UAT',
    server: 'ChatBot / NLU',
    service: 'retriever_api_service',
    version: 'v1.4.2',
    developerName: 'Muhammad Bilal',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Updated vector similarity threshold to 0.82',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for acceptance testing with new embeddings model.',
    source: 'Teams DM',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    id: 'rel-106',
    environment: 'Prod',
    server: 'Chat-Service',
    service: 'chat-service',
    version: 'v2.3.8',
    developerName: 'Muhammad Bilal',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: false,
    commandDetails: null,
    note: 'Stable production baseline release.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
  },
];

// Helper to validate Bearer token
export function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7).trim();
  const secret =
    process.env.API_SECRET_KEY ||
    process.env.NEXT_PUBLIC_API_SECRET_KEY ||
    'your-enterprise-release-api-secret';

  if (secret && token !== secret) {
    return false;
  }

  return Boolean(token);
}

// GET /api/records - Retrieve all records (ordered by most recent first)
export async function GET() {
  try {
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      const records = await prisma.releaseRecord.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ success: true, records }, { status: 200 });
    }
  } catch (dbError) {
    console.warn('Prisma DB query failed, using in-memory store:', dbError);
  }

  // Fallback to in-memory store
  return NextResponse.json({ success: true, records: fallbackRecords }, { status: 200 });
}

// Service item representation within a Batch release
interface BatchServiceItem {
  server: string;
  service: string;
  version: string;
  developerName?: string;
  status?: string;
  isBuildUpdate?: boolean;
}

// POST /api/records - Single & Batch Write-Path API
export async function POST(request: NextRequest) {
  // 1. Auth Requirement
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or missing Bearer token in Authorization header.',
      },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    // Determine if this is a Batch Release or Single Release
    const isBatchPayload =
      Boolean(body.services) && Array.isArray(body.services) && body.services.length > 0;
    const isDirectArray = Array.isArray(body) && body.length > 0;

    // Shared global attributes
    const environment = String(
      (isDirectArray ? body[0]?.environment : body.environment) || ''
    ).trim();
    const added_by = String(
      (isDirectArray ? body[0]?.added_by : body.added_by) || 'A.Hameed'
    ).trim();
    const globalDeveloperName = String(
      (isDirectArray ? body[0]?.developerName : body.developerName) || ''
    ).trim();
    const source = String(
      (isDirectArray ? body[0]?.source : body.source) || 'Teams Group'
    ).trim();
    const note = (isDirectArray ? body[0]?.note : body.note)
      ? String(isDirectArray ? body[0]?.note : body.note).trim()
      : null;

    // Common change configs & scripts
    const isBuildUpdate = Boolean(
      isDirectArray ? body[0]?.isBuildUpdate ?? true : body.isBuildUpdate ?? true
    );
    const isEnvUpdate = Boolean(
      isDirectArray ? body[0]?.isEnvUpdate : body.isEnvUpdate
    );
    const envDetails = (isDirectArray ? body[0]?.envDetails : body.envDetails)
      ? String(isDirectArray ? body[0]?.envDetails : body.envDetails).trim()
      : null;
    const isConfigUpdate = Boolean(
      isDirectArray ? body[0]?.isConfigUpdate : body.isConfigUpdate
    );
    const configDetails = (isDirectArray ? body[0]?.configDetails : body.configDetails)
      ? String(isDirectArray ? body[0]?.configDetails : body.configDetails).trim()
      : null;
    const hasCommands = Boolean(
      isDirectArray ? body[0]?.hasCommands : body.hasCommands
    );
    const commandDetails = (isDirectArray ? body[0]?.commandDetails : body.commandDetails)
      ? String(isDirectArray ? body[0]?.commandDetails : body.commandDetails).trim()
      : null;

    // Strict uppercase status standard: 'SUCCESS' | 'FAILED' | 'PENDING'
    const rawGlobalStatus = String(
      (isDirectArray ? body[0]?.status : body.status) || 'PENDING'
    ).trim().toUpperCase();
    const normalizedGlobalStatus: ReleaseStatus = ['SUCCESS', 'FAILED', 'PENDING'].includes(
      rawGlobalStatus
    )
      ? (rawGlobalStatus as ReleaseStatus)
      : 'PENDING';

    // Validate global mandatory fields
    if (!environment) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Missing required field: environment (must be SIT, UAT, or Prod)',
        },
        { status: 400 }
      );
    }

    if (!added_by) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Missing required field: added_by',
        },
        { status: 400 }
      );
    }

    // Extract raw service list to process
    let rawServices: BatchServiceItem[] = [];

    if (isDirectArray) {
      rawServices = body.map((item: any) => ({
        server: item.server,
        service: item.service,
        version: item.version,
        developerName: item.developerName || globalDeveloperName,
        status: item.status,
        isBuildUpdate: item.isBuildUpdate,
      }));
    } else if (isBatchPayload) {
      rawServices = body.services;
    } else {
      // Single record submission backward compatibility
      if (!body.server || !body.service || !body.version) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'Single release submission requires server, service, and version.',
          },
          { status: 400 }
        );
      }
      rawServices = [
        {
          server: body.server,
          service: body.service,
          version: body.version,
          developerName: body.developerName || globalDeveloperName,
          status: body.status,
          isBuildUpdate: body.isBuildUpdate,
        },
      ];
    }

    if (rawServices.length === 0) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'At least one service update is required in the deployment batch.',
        },
        { status: 400 }
      );
    }

    // Validate each service in the batch
    for (let i = 0; i < rawServices.length; i++) {
      const s = rawServices[i];
      if (!s.server || !String(s.server).trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: `Service at index #${i + 1} is missing the required 'server' field.`,
          },
          { status: 400 }
        );
      }
      if (!s.service || !String(s.service).trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: `Service at index #${i + 1} (${s.server}) is missing the required 'service' field.`,
          },
          { status: 400 }
        );
      }
      if (!s.version || !String(s.version).trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: `Service at index #${i + 1} (${s.service}) is missing the required 'version' (Docker Image Tag).`,
          },
          { status: 400 }
        );
      }
    }

    // Shared unified timestamp for this entire deployment batch
    const sharedTimestamp = new Date().toISOString();

    // Prepare ReleaseRecords: looping through the dynamic Services Array
    const recordsToCreate: ReleaseRecord[] = rawServices.map((svc) => {
      const itemRawStatus = svc.status
        ? String(svc.status).trim().toUpperCase()
        : normalizedGlobalStatus;
      const itemStatus: ReleaseStatus = ['SUCCESS', 'FAILED', 'PENDING'].includes(itemRawStatus)
        ? (itemRawStatus as ReleaseStatus)
        : normalizedGlobalStatus;

      const itemDeveloperName = String(
        svc.developerName || globalDeveloperName || added_by
      ).trim();

      return {
        id: crypto.randomUUID(),
        environment,
        server: String(svc.server).trim(),
        service: String(svc.service).trim(),
        version: String(svc.version).trim(),
        developerName: itemDeveloperName,
        status: itemStatus,
        isBuildUpdate: Boolean(svc.isBuildUpdate ?? isBuildUpdate),
        isEnvUpdate,
        envDetails,
        isConfigUpdate,
        configDetails,
        hasCommands,
        commandDetails,
        note,
        source,
        added_by,
        createdAt: sharedTimestamp,
        updatedAt: sharedTimestamp,
      };
    });

    // Persist records to database via Prisma client
    const savedRecords: ReleaseRecord[] = [];
    const prisma = await getPrismaClient();

    if (prisma && prisma.releaseRecord) {
      for (const rec of recordsToCreate) {
        try {
          const createdInDb = await prisma.releaseRecord.create({
            data: {
              id: rec.id,
              environment: rec.environment,
              server: rec.server,
              service: rec.service,
              version: rec.version,
              developerName: rec.developerName,
              status: rec.status,
              isBuildUpdate: rec.isBuildUpdate,
              isEnvUpdate: rec.isEnvUpdate,
              envDetails: rec.envDetails,
              isConfigUpdate: rec.isConfigUpdate,
              configDetails: rec.configDetails,
              hasCommands: rec.hasCommands,
              commandDetails: rec.commandDetails,
              note: rec.note,
              source: rec.source,
              added_by: rec.added_by,
            },
          });
          savedRecords.push(createdInDb as ReleaseRecord);
        } catch (dbError) {
          console.warn('Prisma create failed for batch item, keeping memory copy:', dbError);
          savedRecords.push(rec);
        }
      }
    } else {
      savedRecords.push(...recordsToCreate);
    }

    // Prepend all created records into in-memory store (most recent first)
    for (let i = savedRecords.length - 1; i >= 0; i--) {
      fallbackRecords.unshift(savedRecords[i]);
    }

    // Return created records with count and primary record representation
    return NextResponse.json(
      {
        success: true,
        message: `Batch deployment logged successfully with ${savedRecords.length} service(s).`,
        count: savedRecords.length,
        records: savedRecords,
        record: savedRecords[0],
        ...savedRecords[0], // backward compatibility for clients expecting single object properties
      },
      { status: 201 }
    );
  } catch (parseError: any) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: parseError?.message || 'Invalid JSON request payload.',
      },
      { status: 400 }
    );
  }
}
