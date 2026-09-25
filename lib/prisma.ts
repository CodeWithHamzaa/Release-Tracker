// Prisma Client initialization.
//
// Two modes:
// - Strict (production / Vercel): the database is the only source of truth.
//   A missing DATABASE_URL or a failed connection throws
//   DatabaseUnavailableError so the API answers 503 instead of quietly
//   serving the in-memory mock records.
// - Local dev: with no valid connection string, getPrismaClient() returns
//   null and the API falls back to the in-memory mock records.

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: any;
}

let prismaClientInstance: any = null;
let isPrismaTestedAndUnavailable = false;

export class DatabaseUnavailableError extends Error {
  // Safe to return to clients: a short cause, never the connection string.
  readonly reason: string;

  constructor(reason: string) {
    super('Database unavailable');
    this.name = 'DatabaseUnavailableError';
    this.reason = reason;
  }
}

export function isStrictDatabaseMode(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

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

// Describe a Prisma failure without echoing anything that could contain
// credentials: the error code/name plus the first line of the message, with
// any connection-string-looking text scrubbed.
function describeError(err: unknown): string {
  const e = err as { errorCode?: string; code?: string; name?: string; message?: string };
  const code = e?.errorCode || e?.code || e?.name || 'UnknownError';
  const firstLine = String(e?.message || '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) || '';
  const scrubbed = firstLine.replace(/\b(postgres(ql)?|prisma):\/\/\S+/gi, '<connection-string>');
  return scrubbed ? `${code}: ${scrubbed}` : code;
}

export async function getPrismaClient() {
  const strict = isStrictDatabaseMode();

  if (prismaClientInstance) {
    return prismaClientInstance;
  }

  if (globalThis.prismaGlobal) {
    prismaClientInstance = globalThis.prismaGlobal;
    return prismaClientInstance;
  }

  // Only local dev caches "unavailable". In strict mode every request retries,
  // so one transient failure can't pin a warm lambda to errors for its lifetime.
  if (!strict && isPrismaTestedAndUnavailable) {
    return null;
  }

  const effectiveUrl = resolvePostgresUrl();
  if (!effectiveUrl) {
    if (strict) {
      console.error('[prisma] DATABASE_URL / DIRECT_URL missing or not a postgres:// URL');
      throw new DatabaseUnavailableError('DATABASE_URL is not configured');
    }
    isPrismaTestedAndUnavailable = true;
    return null;
  }

  let client: any = null;
  try {
    const pkg = '@prisma/client';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = (await import(/* @vite-ignore */ pkg)) as any;

    client = new PrismaClient({
      datasources: {
        db: { url: effectiveUrl },
      },
      log: [],
    });

    // Test connection once to ensure credentials and host are reachable
    await client.$connect();
    if (process.env.NODE_ENV !== 'production') {
      globalThis.prismaGlobal = client;
    }
    prismaClientInstance = client;
    return client;
  } catch (err) {
    if (client) {
      await client.$disconnect().catch(() => {});
    }
    const reason = describeError(err);
    console.error('[prisma] connection failed:', reason);
    if (strict) {
      throw new DatabaseUnavailableError(reason);
    }
    isPrismaTestedAndUnavailable = true;
    return null;
  }
}
