/**
 * db/prisma.ts — Shared Prisma client singleton
 *
 * Reuses a single Prisma client instance across all API modules.
 * Prevents connection pool exhaustion in development (hot reload).
 */

import { PrismaClient } from '@prisma/client';

// Singleton pattern — prevents multiple clients in dev with hot reload
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
