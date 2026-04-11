/**
 * @file gatewaySwitchProcessor.ts
 * @description BullMQ worker that processes gateway switch reminder and suspend jobs.
 *   Runs as part of the API process (not standalone worker).
 *   Follows the WebhookJobProcessor initialization pattern.
 * @layer infrastructure
 */

import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import type { PrismaClient } from "@infra/prisma";
import type { EmailPort } from "../domain/repositories/EmailPort.js";
import { logger } from "../lib/logger.js";

interface SwitchJobData {
  accountId: string;
  switchEventId: string;
  type: "REMINDER" | "SUSPEND";
}

export class GatewaySwitchProcessor {
  private worker: Worker<SwitchJobData>;

  constructor(
    redisConnection: Redis,
    private readonly prisma: PrismaClient,
    private readonly emailPort: EmailPort
  ) {
    this.worker = new Worker<SwitchJobData>(
      QUEUE_NAMES.GATEWAY_SWITCH,
      async (job) => this.processJob(job),
      {
        connection: redisConnection,
        concurrency: 1,
      }
    );

    this.worker.on("completed", (job) => {
      logger.info(
        { jobId: job.id, type: job.data.type, accountId: job.data.accountId },
        "Gateway switch job completed"
      );
    });

    this.worker.on("failed", (job, error) => {
      logger.error(
        {
          jobId: job?.id,
          type: job?.data.type,
          accountId: job?.data.accountId,
          err: error.message,
        },
        "Gateway switch job failed"
      );
    });
  }

  private async processJob(job: Job<SwitchJobData>): Promise<void> {
    const { accountId, type } = job.data;

    // Verify switch is still PENDING_CHECKOUT
    const switchEvent = await this.prisma.gatewaySwitchEvent.findFirst({
      where: { accountId, status: "PENDING_CHECKOUT" },
      orderBy: { createdAt: "desc" },
    });

    if (!switchEvent) {
      // Switch was completed or cancelled before this job ran — no-op
      return;
    }

    if (type === "REMINDER") {
      await this.processReminder(accountId, switchEvent.id);
    } else if (type === "SUSPEND") {
      await this.processSuspend(accountId, switchEvent.id);
    }
  }

  private async processReminder(accountId: string, switchEventId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { email: true, pendingGatewayProvider: true },
    });

    if (account?.email) {
      await this.emailPort.send({
        to: [account.email],
        subject: "Reminder: Complete your payment gateway switch",
        body: `You have 24 hours remaining to complete your subscription setup on ${account.pendingGatewayProvider ?? "your new provider"}. If you don't complete the switch, your account will be suspended.`,
      });
    }

    await this.prisma.gatewaySwitchEvent.update({
      where: { id: switchEventId },
      data: { reminderSentAt: new Date() },
    });
  }

  private async processSuspend(accountId: string, switchEventId: string): Promise<void> {
    // Re-check deadline (may have been extended)
    const switchEvent = await this.prisma.gatewaySwitchEvent.findUnique({
      where: { id: switchEventId },
    });
    if (!switchEvent || switchEvent.status !== "PENDING_CHECKOUT") return;

    const deadline = switchEvent.extendedUntil ?? switchEvent.scheduledFor;
    if (deadline.getTime() > Date.now()) {
      // Deadline was extended — don't suspend yet
      return;
    }

    await this.prisma.$transaction([
      this.prisma.accountSubscription.updateMany({
        where: { accountId },
        data: { status: "CANCELED" },
      }),
      this.prisma.gatewaySwitchEvent.update({
        where: { id: switchEventId },
        data: { status: "SUSPENDED", suspendedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          action: "GATEWAY_SWITCH_AUTO_SUSPENDED",
          resource: "account",
          resourceId: accountId,
          details: { switchEventId, reason: "Checkout window expired" },
          success: true,
        },
      }),
    ]);

    // Notify account
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { email: true },
    });
    if (account?.email) {
      await this.emailPort.send({
        to: [account.email],
        subject: "Account suspended — gateway switch incomplete",
        body: "Your account has been suspended because the gateway switch was not completed in time. Please contact support or subscribe again.",
      });
    }
  }

  async shutdown(): Promise<void> {
    await this.worker.close();
  }
}
