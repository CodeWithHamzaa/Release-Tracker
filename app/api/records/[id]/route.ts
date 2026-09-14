import { NextRequest, NextResponse } from 'next/server';
import { getPrismaClient } from '@/lib/prisma';
import { fallbackRecords, isAuthorized } from '../route';
import { ReleaseRecord } from '@/lib/types';

// GET /api/records/[id] - Fetch single record by ID
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const params = await Promise.resolve(context.params);
    const id = params.id;

    if (!id) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Record ID parameter is missing.' },
        { status: 400 }
      );
    }

    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      try {
        const record = await prisma.releaseRecord.findUnique({
          where: { id },
        });
        if (record) {
          return NextResponse.json(record, { status: 200 });
        }
      } catch (dbError) {
        console.warn('Prisma findUnique failed, checking in-memory store:', dbError);
      }
    }

    const fallback = fallbackRecords.find((r) => r.id === id);
    if (fallback) {
      return NextResponse.json(fallback, { status: 200 });
    }

    return NextResponse.json(
      { error: 'Not Found', message: `Release record with id ${id} not found.` },
      { status: 404 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Internal Error', message: err.message || 'Failed to fetch record.' },
      { status: 500 }
    );
  }
}

// PATCH /api/records/[id] - Update record with ID extracted from URL parameters
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const params = await Promise.resolve(context.params);
    const id = params.id;

    if (!id) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Record ID parameter is missing in URL route.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { status, note, version, developerName, server, service, environment, commandDetails, envDetails, configDetails } = body;

    const dataToUpdate: Record<string, any> = {};

    // Strict uppercase status standard: 'SUCCESS' | 'FAILED' | 'PENDING'
    if (status !== undefined) {
      const upperStatus = String(status).trim().toUpperCase();
      if (!['SUCCESS', 'FAILED', 'PENDING'].includes(upperStatus)) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: "Status must be strictly uppercase: 'SUCCESS', 'FAILED', or 'PENDING'.",
          },
          { status: 400 }
        );
      }
      dataToUpdate.status = upperStatus;
    }

    if (note !== undefined) {
      dataToUpdate.note = note ? String(note).trim() : null;
    }

    if (version !== undefined) {
      dataToUpdate.version = String(version).trim();
    }

    if (developerName !== undefined) {
      dataToUpdate.developerName = String(developerName).trim();
    }

    if (server !== undefined) {
      dataToUpdate.server = String(server).trim();
    }

    if (service !== undefined) {
      dataToUpdate.service = String(service).trim();
    }

    if (environment !== undefined) {
      dataToUpdate.environment = String(environment).trim();
    }

    if (commandDetails !== undefined) {
      dataToUpdate.commandDetails = commandDetails ? String(commandDetails).trim() : null;
      dataToUpdate.hasCommands = Boolean(dataToUpdate.commandDetails);
    }

    if (envDetails !== undefined) {
      dataToUpdate.envDetails = envDetails ? String(envDetails).trim() : null;
      dataToUpdate.isEnvUpdate = Boolean(dataToUpdate.envDetails);
    }

    if (configDetails !== undefined) {
      dataToUpdate.configDetails = configDetails ? String(configDetails).trim() : null;
      dataToUpdate.isConfigUpdate = Boolean(dataToUpdate.configDetails);
    }

    // Try updating via Prisma
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      try {
        const updatedInDb = await prisma.releaseRecord.update({
          where: { id },
          data: {
            ...dataToUpdate,
            updatedAt: new Date(),
          },
        });
        return NextResponse.json(updatedInDb, { status: 200 });
      } catch (dbError) {
        console.warn('Prisma update failed, updating in-memory store:', dbError);
      }
    }

    // Update in fallbackRecords store
    const idx = fallbackRecords.findIndex((r) => r.id === id);
    if (idx === -1) {
      // If not in fallback, create a mock updated record
      const mockUpdated: ReleaseRecord = {
        id,
        environment: environment || 'Prod',
        server: server || 'Bot-Builder',
        service: service || 'bot-builder-api',
        version: version || 'v1.0.0',
        developerName: developerName || 'Developer',
        status: dataToUpdate.status || 'PENDING',
        isBuildUpdate: true,
        isEnvUpdate: Boolean(dataToUpdate.envDetails),
        envDetails: dataToUpdate.envDetails || null,
        isConfigUpdate: Boolean(dataToUpdate.configDetails),
        configDetails: dataToUpdate.configDetails || null,
        hasCommands: Boolean(dataToUpdate.commandDetails),
        commandDetails: dataToUpdate.commandDetails || null,
        note: dataToUpdate.note || null,
        source: 'Teams Group',
        added_by: 'A.Hameed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fallbackRecords.unshift(mockUpdated);
      return NextResponse.json(mockUpdated, { status: 200 });
    }

    fallbackRecords[idx] = {
      ...fallbackRecords[idx],
      ...dataToUpdate,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(fallbackRecords[idx], { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Bad Request', message: err.message || 'Failed to update record.' },
      { status: 400 }
    );
  }
}
