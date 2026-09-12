// Prisma Client initialization with fallback handling
// Allows graceful execution when DATABASE_URL is provided in Supabase

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: any;
}

let prismaClientInstance: any = null;

export async function getPrismaClient() {
  if (prismaClientInstance) {
    return prismaClientInstance;
  }

  if (globalThis.prismaGlobal) {
    prismaClientInstance = globalThis.prismaGlobal;
    return prismaClientInstance;
  }

  try {
    const pkg = '@prisma/client';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = (await import(/* @vite-ignore */ pkg)) as any;
    const client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    if (process.env.NODE_ENV !== 'production') {
      globalThis.prismaGlobal = client;
    }
    prismaClientInstance = client;
    return client;
  } catch (err) {
    console.warn('PrismaClient could not be initialized or generated:', err);
    return null;
  }
}
