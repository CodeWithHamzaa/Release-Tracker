// Prisma Client initialization with fallback handling
// Allows graceful execution when a valid PostgreSQL connection string is provided

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: any;
}

let prismaClientInstance: any = null;
let isPrismaTestedAndUnavailable = false;

function isValidPostgresUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('postgresql://') ||
    trimmed.startsWith('postgres://') ||
    trimmed.startsWith('prisma://')
  );
}

function resolvePostgresUrl(): string | null {
  if (isValidPostgresUrl(process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL!.trim();
  }
  if (isValidPostgresUrl(process.env.DIRECT_URL)) {
    return process.env.DIRECT_URL!.trim();
  }
  return null;
}

export async function getPrismaClient() {
  if (isPrismaTestedAndUnavailable) {
    return null;
  }

  if (prismaClientInstance) {
    return prismaClientInstance;
  }

  if (globalThis.prismaGlobal) {
    prismaClientInstance = globalThis.prismaGlobal;
    return prismaClientInstance;
  }

  const effectiveUrl = resolvePostgresUrl();
  if (!effectiveUrl) {
    // Skip Prisma if neither DATABASE_URL nor DIRECT_URL is a valid PostgreSQL URL
    isPrismaTestedAndUnavailable = true;
    return null;
  }

  try {
    const pkg = '@prisma/client';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = (await import(/* @vite-ignore */ pkg)) as any;

    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = effectiveUrl;

    const client = new PrismaClient({
      datasources: {
        db: { url: effectiveUrl },
      },
      log: [],
    });

    // Test connection once to ensure credentials and host are reachable
    try {
      await client.$connect();
      if (process.env.NODE_ENV !== 'production') {
        globalThis.prismaGlobal = client;
      }
      prismaClientInstance = client;
      return client;
    } catch {
      await client.$disconnect().catch(() => {});
      if (originalDatabaseUrl) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      isPrismaTestedAndUnavailable = true;
      return null;
    }
  } catch {
    isPrismaTestedAndUnavailable = true;
    return null;
  }
}

