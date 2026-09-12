import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/prisma';
import { ReleaseRecord } from '@/lib/types';

// In-memory fallback store for preview and local development when Prisma/DB is pending
const fallbackRecords: ReleaseRecord[] = [
  {
    id: 'rel-101',
    environment: 'Prod',
    server: 'Bot-Builder',
    service: 'bot-builder-api',
    developerName: 'Sufyan Tariq',
    status: 'Success',
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
    developerName: 'Muhammad Bilal',
    status: 'Pending',
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
    server: 'Auth-Gateway',
    service: 'oauth-provider',
    developerName: 'Ali Raza',
    status: 'Failed',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'NEW_SAML_ENTITY_ID=https://auth.internal.corp/saml',
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d',
    note: 'Initial build failed OAuth handshake verification. Fix in progress.',
    source: 'Teams DM',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
];

// Helper to validate Bearer token
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7).trim();
  const secret = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_API_SECRET_KEY || 'your-enterprise-release-api-secret';

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

// POST /api/records - Single Write-Path API
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
    const {
      environment,
      server,
      service,
      developerName,
      status = 'Pending',
      source,
      added_by,
      isBuildUpdate = false,
      isEnvUpdate = false,
      envDetails = null,
      isConfigUpdate = false,
      configDetails = null,
      hasCommands = false,
      commandDetails = null,
      note = null,
    } = body;

    // Validate required fields (fileOrLink removed, developerName added)
    const missingFields: string[] = [];
    if (!environment) missingFields.push('environment');
    if (!server) missingFields.push('server');
    if (!service) missingFields.push('service');
    if (!developerName) missingFields.push('developerName');
    if (!source) missingFields.push('source');
    if (!added_by) missingFields.push('added_by');

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: `Missing required fields: ${missingFields.join(', ')}`,
          missingFields,
        },
        { status: 400 }
      );
    }

    // Validate status value
    const normalizedStatus = ['Success', 'Failed', 'Pending'].includes(status) ? status : 'Pending';

    const newRecord: ReleaseRecord = {
      id: crypto.randomUUID(),
      environment: String(environment).trim(),
      server: String(server).trim(),
      service: String(service).trim(),
      developerName: String(developerName).trim(),
      status: normalizedStatus,
      isBuildUpdate: Boolean(isBuildUpdate),
      isEnvUpdate: Boolean(isEnvUpdate),
      envDetails: envDetails ? String(envDetails).trim() : null,
      isConfigUpdate: Boolean(isConfigUpdate),
      configDetails: configDetails ? String(configDetails).trim() : null,
      hasCommands: Boolean(hasCommands),
      commandDetails: commandDetails ? String(commandDetails).trim() : null,
      note: note ? String(note).trim() : null,
      source: String(source).trim(),
      added_by: String(added_by).trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Create record via Prisma
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      try {
        const createdInDb = await prisma.releaseRecord.create({
          data: {
            id: newRecord.id,
            environment: newRecord.environment,
            server: newRecord.server,
            service: newRecord.service,
            developerName: newRecord.developerName,
            status: newRecord.status,
            isBuildUpdate: newRecord.isBuildUpdate,
            isEnvUpdate: newRecord.isEnvUpdate,
            envDetails: newRecord.envDetails,
            isConfigUpdate: newRecord.isConfigUpdate,
            configDetails: newRecord.configDetails,
            hasCommands: newRecord.hasCommands,
            commandDetails: newRecord.commandDetails,
            note: newRecord.note,
            source: newRecord.source,
            added_by: newRecord.added_by,
          },
        });
        return NextResponse.json(createdInDb, { status: 201 });
      } catch (dbError) {
        console.warn('Database insert failed, persisting to in-memory store:', dbError);
      }
    }

    // Prepend to fallback store
    fallbackRecords.unshift(newRecord);
    return NextResponse.json(newRecord, { status: 201 });
  } catch (parseError: any) {
    return NextResponse.json(
      {
        error: 'Bad Request',
        message: parseError?.message || 'Invalid JSON body in request.',
      },
      { status: 400 }
    );
  }
}

// PUT /api/records - Edit & Update Existing Record
export async function PUT(request: NextRequest) {
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
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Record ID is required for update.' },
        { status: 400 }
      );
    }

    if (updates.status && !['Success', 'Failed', 'Pending'].includes(updates.status)) {
      return NextResponse.json(
        { error: 'Bad Request', message: "Status must be 'Success', 'Failed', or 'Pending'." },
        { status: 400 }
      );
    }

    // Try updating via Prisma
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      try {
        const updated = await prisma.releaseRecord.update({
          where: { id },
          data: {
            ...updates,
            updatedAt: new Date(),
          },
        });
        return NextResponse.json(updated, { status: 200 });
      } catch (dbError) {
        console.warn('Prisma update failed, updating in-memory store:', dbError);
      }
    }

    // Update in fallback records
    const idx = fallbackRecords.findIndex((r) => r.id === id);
    if (idx === -1) {
      return NextResponse.json(
        { error: 'Not Found', message: `Record with id ${id} not found.` },
        { status: 400 }
      );
    }

    fallbackRecords[idx] = {
      ...fallbackRecords[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(fallbackRecords[idx], { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Bad Request', message: err.message || 'Failed to parse update request.' },
      { status: 400 }
    );
  }
}

// Support PATCH as well
export async function PATCH(request: NextRequest) {
  return PUT(request);
}
