/**
 * Athena V2 - Prisma Client Singleton
 * Single shared instance used across all routes and lib files.
 * Prevents connection pool exhaustion from multiple PrismaClient instantiations.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export { prisma };
