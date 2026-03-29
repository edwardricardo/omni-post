/**
 * Queue Management Routes
 *
 * Admin endpoints for monitoring and managing the BullMQ publishing queue.
 * Provides job listing, stats, individual job details, retry, and removal.
 *
 * All routes read job data from the BullMQ publish queue (QUEUE_NAMES.PUBLISH)
 * via a dedicated read-only Queue connection created inside the plugin scope.
 * The connection is properly cleaned up via an onClose hook.
 *
 * @module admin/queueRoutes
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { Queue, Job } from "bullmq";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { requireAdminAuth, requireAdmin } from "./auth/adminAuthMiddleware.js";
import { getRedisUrl } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

const log = createLogger("admin-queue-routes");

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const JobIdSchema = z.object({ id: z.string().min(1) });

const ListJobsQuerySchema = z.object({
  types: z.string().optional(), // comma-separated: "waiting,active,completed,failed,delayed"
  start: z.coerce.number().int().min(0).optional(),
  end: z.coerce.number().int().min(0).optional(),
});

// BullMQ job states accepted by getJobs()
type BullMQJobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";

const VALID_STATES = new Set<string>([
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
  "paused",
]);

function filterValidStates(input: string[]): BullMQJobState[] {
  return input.filter((s) => VALID_STATES.has(s)) as BullMQJobState[];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

class QueueRouteHandler extends BaseRouteHandler {
  protected routeName = "admin-queue";

  constructor(private readonly queue: Queue) {
    super();
  }

  /** GET /admin/queue/stats */
  async getStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Getting queue stats");

    try {
      const counts = await this.queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
        "paused"
      );

      const completedCount = counts.completed ?? 0;
      const failedCount = counts.failed ?? 0;
      const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
      const successRate =
        completedCount + failedCount > 0
          ? (completedCount / (completedCount + failedCount)) * 100
          : 100;

      this.sendSuccess(ctx, {
        total,
        queued: (counts.waiting ?? 0) + (counts.delayed ?? 0),
        processing: counts.active ?? 0,
        published: completedCount,
        failed: failedCount,
        paused: counts.paused ?? 0,
        successRate: Math.round(successRate * 100) / 100,
      });
    } catch (error) {
      this.logError(ctx, "Failed to get queue stats", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendError(ctx, 500, "Failed to get queue stats");
    }
  }

  /** GET /admin/queue/jobs */
  async listJobs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    this.logInfo(ctx, "Listing queue jobs");

    const queryResult = await this.validateQuery(ctx, ListJobsQuerySchema);
    if (!queryResult.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { types, start, end } = queryResult.value;
    const rawTypes = types?.split(",").filter(Boolean) ?? [
      "waiting",
      "active",
      "failed",
      "delayed",
      "completed",
    ];
    const validStates = filterValidStates(rawTypes);
    const rangeStart = start ?? 0;
    const rangeEnd = end ?? 49;

    try {
      const jobs = await this.queue.getJobs(validStates, rangeStart, rangeEnd);
      const items = jobs.map((job) => this.formatJob(job));

      this.sendSuccess(ctx, {
        items,
        total: items.length,
      });
    } catch (error) {
      this.logError(ctx, "Failed to list queue jobs", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendError(ctx, 500, "Failed to list queue jobs");
    }
  }

  /** GET /admin/queue/jobs/:id */
  async getJob(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = await this.validateParams(ctx, JobIdSchema);
    if (!paramsResult.ok) {
      return this.sendError(ctx, 400, "Invalid job ID");
    }

    const { id } = paramsResult.value;

    try {
      const job = await this.queue.getJob(id);
      if (!job) {
        return this.sendError(ctx, 404, "Job not found");
      }

      const [state, jobLogs] = await Promise.all([
        job.getState(),
        this.queue.getJobLogs(job.id!, 0, 50),
      ]);

      this.sendSuccess(ctx, {
        ...this.formatJob(job),
        state,
        logs: jobLogs,
      });
    } catch (error) {
      this.logError(ctx, "Failed to get job", {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendError(ctx, 500, "Failed to get job");
    }
  }

  /** POST /admin/queue/jobs/:id/retry */
  async retryJob(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = await this.validateParams(ctx, JobIdSchema);
    if (!paramsResult.ok) {
      return this.sendError(ctx, 400, "Invalid job ID");
    }

    const { id } = paramsResult.value;

    try {
      const job = await this.queue.getJob(id);
      if (!job) {
        return this.sendError(ctx, 404, "Job not found");
      }

      await job.retry();
      this.logInfo(ctx, "Job retried", { jobId: id });
      this.sendSuccess(ctx, { retried: true, jobId: id });
    } catch (error) {
      this.logError(ctx, "Failed to retry job", {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendError(ctx, 500, "Failed to retry job");
    }
  }

  /** POST /admin/queue/jobs/:id/remove */
  async removeJob(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsResult = await this.validateParams(ctx, JobIdSchema);
    if (!paramsResult.ok) {
      return this.sendError(ctx, 400, "Invalid job ID");
    }

    const { id } = paramsResult.value;

    try {
      const job = await this.queue.getJob(id);
      if (!job) {
        return this.sendError(ctx, 404, "Job not found");
      }

      await job.remove();
      this.logInfo(ctx, "Job removed", { jobId: id });
      this.sendSuccess(ctx, { removed: true, jobId: id });
    } catch (error) {
      this.logError(ctx, "Failed to remove job", {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendError(ctx, 500, "Failed to remove job");
    }
  }

  private formatJob(job: Job): Record<string, unknown> {
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      ...(job.opts?.attempts !== undefined && { maxAttempts: job.opts.attempts }),
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      ...(job.failedReason && { failedReason: job.failedReason }),
      ...(job.stacktrace?.length && { stacktrace: job.stacktrace }),
      delay: job.delay,
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export const queueRoutes: FastifyPluginAsync = async (fastify) => {
  // Parse the shared Redis URL into connection options.
  // lazyConnect: true prevents this read-only connection from blocking startup
  // when Redis is not yet reachable (e.g. Railway private network cold-start).
  const redisUrl = getRedisUrl();
  const parsedUrl = new URL(redisUrl);

  const queue = new Queue(QUEUE_NAMES.PUBLISH, {
    connection: {
      host: parsedUrl.hostname || "localhost",
      port: Number(parsedUrl.port) || 6379,
      ...(parsedUrl.password && { password: parsedUrl.password }),
      lazyConnect: true,
      enableOfflineQueue: true,
    },
  });

  log.info(`Queue management routes registered — queue: ${QUEUE_NAMES.PUBLISH}`);

  const handler = new QueueRouteHandler(queue);

  // Stats overview
  fastify.get(
    "/admin/queue/stats",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Queues"], summary: "Get queue statistics" },
    },
    (req, rep) => handler.getStats(req, rep)
  );

  // List jobs (with optional type filter + pagination)
  fastify.get(
    "/admin/queue/jobs",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Queues"], summary: "List queue jobs" },
    },
    (req, rep) => handler.listJobs(req, rep)
  );

  // Get single job by BullMQ job ID
  fastify.get(
    "/admin/queue/jobs/:id",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Queues"], summary: "Get job by ID" },
    },
    (req, rep) => handler.getJob(req, rep)
  );

  // Retry a failed job
  fastify.post(
    "/admin/queue/jobs/:id/retry",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Queues"], summary: "Retry failed job" },
    },
    (req, rep) => handler.retryJob(req, rep)
  );

  // Remove a job from the queue
  fastify.post(
    "/admin/queue/jobs/:id/remove",
    {
      preHandler: [requireAdminAuth, requireAdmin],
      schema: { tags: ["Admin Queues"], summary: "Remove job from queue" },
    },
    (req, rep) => handler.removeJob(req, rep)
  );

  // Gracefully close the dedicated queue connection on server shutdown
  fastify.addHook("onClose", async () => {
    await queue.close().catch((err: unknown) => {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, "Queue close warning");
    });
  });
};
