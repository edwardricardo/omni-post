import { PrismaClient } from "@prisma/client";
import { cpus } from "os";
const g = globalThis;
// Connection pool configuration based on environment
const getConnectionPoolConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const cpuCount = cpus().length;
  return {
    // Connection pool size - scale with CPU cores
    connection_limit: isProduction
      ? Math.max(cpuCount * 2, 10) // Production: 2x CPU cores, minimum 10
      : Math.min(cpuCount + 2, 8), // Development: CPU + 2, maximum 8
    // Connection timeout (in seconds)
    connect_timeout: 10,
    // Pool timeout (in seconds) - how long to wait for connection from pool
    pool_timeout: 10,
    // How long to keep unused connections alive (in seconds)
    // PostgreSQL default timeout is 10 minutes, so we set slightly less
    socket_timeout: 580, // 9 minutes 40 seconds
  };
};
// Build optimized DATABASE_URL with connection pool parameters
const buildDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  const url = new URL(baseUrl);
  const poolConfig = getConnectionPoolConfig();
  // Add connection pool parameters to URL
  url.searchParams.set("connection_limit", poolConfig.connection_limit.toString());
  url.searchParams.set("connect_timeout", poolConfig.connect_timeout.toString());
  url.searchParams.set("pool_timeout", poolConfig.pool_timeout.toString());
  url.searchParams.set("socket_timeout", poolConfig.socket_timeout.toString());
  // Additional PostgreSQL optimizations
  url.searchParams.set("sslmode", process.env.NODE_ENV === "production" ? "require" : "prefer");
  url.searchParams.set("application_name", "omni-post-api");
  return url.toString();
};
// Simplified logging - complex configurations moved to conditional event handlers
// Create optimized Prisma client
export const prisma =
  g.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: buildDatabaseUrl(),
      },
    },
    log:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["query", "info", "warn", "error"],
    // Additional performance optimizations
    errorFormat: process.env.NODE_ENV === "production" ? "minimal" : "pretty",
    // Transaction options
    transactionOptions: {
      isolationLevel: "ReadCommitted", // Good balance of consistency and performance
      maxWait: 5000, // 5 seconds max wait for transaction
      timeout: 30000, // 30 seconds transaction timeout
    },
  });
// Track connection count for monitoring
if (!g.prismaConnectionCount) {
  g.prismaConnectionCount = 0;
}
// Setup connection monitoring and optimization
if (process.env.NODE_ENV !== "production") {
  g.prisma = prisma;
  // Log slow queries in development (conditional based on log config)
  if (process.env.ENABLE_QUERY_LOGGING === "true") {
    prisma.$on("query", (e) => {
      if (e.duration > 1000) {
        // Log queries taking more than 1 second
        console.warn(`🐌 Slow query detected (${e.duration}ms):`, e.query);
      }
    });
  }
}
// Production monitoring setup
if (process.env.NODE_ENV === "production") {
  // Log slow queries and errors (conditional based on log config)
  if (process.env.ENABLE_QUERY_LOGGING === "true") {
    prisma.$on("query", (e) => {
      if (e.duration > 2000) {
        // Log queries taking more than 2 seconds in production
        console.warn(`Slow query detected (${e.duration}ms):`, {
          query: e.query.substring(0, 200) + "...", // Truncate for security
          duration: e.duration,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }
  // Error tracking
  prisma.$on("error", (e) => {
    console.error("Prisma error:", {
      message: e.message,
      timestamp: new Date().toISOString(),
    });
  });
}
// Connection pool monitoring utilities
export const getConnectionPoolStats = () => {
  const poolConfig = getConnectionPoolConfig();
  return {
    configured_limit: poolConfig.connection_limit,
    connect_timeout: poolConfig.connect_timeout,
    pool_timeout: poolConfig.pool_timeout,
    socket_timeout: poolConfig.socket_timeout,
    current_connections: g.prismaConnectionCount || 0,
  };
};
// Graceful shutdown helper
export const closeDatabaseConnections = async () => {
  try {
    await prisma.$disconnect();
    console.log("Database connections closed gracefully");
  } catch {
    console.error("Error closing database connections:", error);
  }
};
// Health check helper
export const checkDatabaseHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1 as health_check`;
    return { healthy: true, timestamp: new Date() };
  } catch {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date(),
    };
  }
};
//# sourceMappingURL=client.js.map
