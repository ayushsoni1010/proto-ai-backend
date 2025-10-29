import { PrismaClient } from "@prisma/client";
import { databaseConfig, serverConfig } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: serverConfig.nodeEnv === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url: databaseConfig.url,
      },
    },
  });

if (serverConfig.nodeEnv !== "production") globalForPrisma.prisma = prisma;

export default prisma;
