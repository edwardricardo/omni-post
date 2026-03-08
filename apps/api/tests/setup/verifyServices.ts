/**
 * Service Verification and Auto-Start Script
 *
 * Verifies that all required services are running on expected ports.
 * If services are not running, attempts to start them via Docker.
 */

import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface ServiceConfig {
  name: string;
  port: number;
  container: string;
  healthCheck: () => Promise<boolean>;
}

const SERVICES: ServiceConfig[] = [
  {
    name: "PostgreSQL",
    port: 5432,
    container: "omnipost-postgres",
    healthCheck: async () => {
      try {
        const { stdout } = await execAsync(
          "docker exec omnipost-postgres pg_isready -U postgres 2>/dev/null"
        );
        return stdout.includes("accepting connections");
      } catch {
        return false;
      }
    },
  },
  {
    name: "Redis",
    port: 6379,
    container: "omnipost-redis",
    healthCheck: async () => {
      try {
        const { stdout } = await execAsync("docker exec omnipost-redis redis-cli ping 2>/dev/null");
        return stdout.trim() === "PONG";
      } catch {
        return false;
      }
    },
  },
];

async function checkPortInUse(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`lsof -i :${port} 2>/dev/null || true`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isContainerRunning(container: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker ps --filter "name=${container}" --filter "status=running" --format "{{.Names}}" 2>/dev/null`
    );
    return stdout.trim() === container;
  } catch {
    return false;
  }
}

async function startDockerServices(): Promise<void> {
  console.log("🐳 Starting Docker services...");
  try {
    execSync("pnpm db:up", {
      stdio: "inherit",
      cwd: process.cwd().replace("/apps/api", ""),
    });
  } catch (error) {
    console.error("Failed to start Docker services:", error);
    throw error;
  }
}

async function waitForService(service: ServiceConfig, maxAttempts = 30): Promise<boolean> {
  console.log(`⏳ Waiting for ${service.name} to be ready...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isHealthy = await service.healthCheck();
    if (isHealthy) {
      console.log(`✅ ${service.name} is ready on port ${service.port}`);
      return true;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error(`❌ ${service.name} failed to become ready after ${maxAttempts} attempts`);
  return false;
}

export async function verifyAndStartServices(): Promise<{
  success: boolean;
  services: Record<string, boolean>;
}> {
  console.log("\n" + "=".repeat(60));
  console.log("🔍 Verifying Required Services");
  console.log("=".repeat(60) + "\n");

  const results: Record<string, boolean> = {};
  let allServicesRunning = true;

  // First check if all services are running
  for (const service of SERVICES) {
    const containerRunning = await isContainerRunning(service.container);
    const portInUse = await checkPortInUse(service.port);
    const isHealthy = await service.healthCheck();

    console.log(`📋 ${service.name}:`);
    console.log(`   Container: ${containerRunning ? "✅ Running" : "❌ Not running"}`);
    console.log(`   Port ${service.port}: ${portInUse ? "✅ In use" : "❌ Not in use"}`);
    console.log(`   Health: ${isHealthy ? "✅ Healthy" : "❌ Not healthy"}`);
    console.log();

    if (!isHealthy) {
      allServicesRunning = false;
    }
    results[service.name] = isHealthy;
  }

  // If not all services are running, try to start them
  if (!allServicesRunning) {
    console.log("\n⚠️  Some services are not running. Attempting to start...\n");

    try {
      await startDockerServices();

      // Wait for services to be ready
      console.log("\n");
      for (const service of SERVICES) {
        const ready = await waitForService(service);
        results[service.name] = ready;
        if (!ready) {
          allServicesRunning = false;
        }
      }
    } catch (error) {
      console.error("Failed to start services:", error);
      return { success: false, services: results };
    }
  }

  // Final verification
  console.log("\n" + "=".repeat(60));
  console.log("📊 Service Status Summary");
  console.log("=".repeat(60));

  let finalSuccess = true;
  for (const service of SERVICES) {
    const isHealthy = await service.healthCheck();
    results[service.name] = isHealthy;
    console.log(`${isHealthy ? "✅" : "❌"} ${service.name}: ${isHealthy ? "Ready" : "Not Ready"}`);
    if (!isHealthy) finalSuccess = false;
  }

  console.log("=".repeat(60) + "\n");

  return { success: finalSuccess, services: results };
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyAndStartServices()
    .then(({ success }) => {
      if (success) {
        console.log("✅ All services are ready for testing!\n");
        process.exit(0);
      } else {
        console.error("❌ Some services failed to start. Tests may fail.\n");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
