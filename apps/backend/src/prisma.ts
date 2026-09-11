import { PrismaClient } from "@prisma/client";

// Single shared instance across the process, standard Prisma guidance for
// serverless/long-running Node servers alike.
export const prisma = new PrismaClient();
