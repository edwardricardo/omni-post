/**
 * @file StreamProcessor.ts
 * @description Handles Redis stream processing for real-time sync events.
 * @layer infrastructure
 */

import type { Redis } from "ioredis";
import type { VersionDiff } from "@shared/types/orchestration.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { EventService } from "../../events/EventService.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("orchestration");

export class StreamProcessor {
  private redis: Redis;
  private eventService: EventService;
  private scheduler: BackgroundTaskScheduler;
  private onRealTimeSync: (postId: string, changes: VersionDiff[]) => Promise<void>;
  private readonly scheduledSyncTaskId = "stream-processor-scheduled-sync";

  constructor(
    redis: Redis,
    eventService: EventService,
    scheduler: BackgroundTaskScheduler,
    onRealTimeSync: (postId: string, changes: VersionDiff[]) => Promise<void>
  ) {
    this.redis = redis;
    this.eventService = eventService;
    this.scheduler = scheduler;
    this.onRealTimeSync = onRealTimeSync;
  }

  /**
   * Setup Redis sync streams
   */
  async setupRedisSyncStreams(): Promise<void> {
    // Create Redis streams for real-time sync events
    await this.redis
      .xgroup("CREATE", "sync:content:changes", "sync-processors", "$", "MKSTREAM")
      .catch(() => {
        // Stream might already exist
      });

    // Setup stream consumer
    this.startStreamConsumer();
  }

  /**
   * Register content change handlers
   */
  registerContentChangeHandlers(): void {
    // Listen for post update events
    this.eventService.registerHandler("POST_UPDATED", {
      eventType: "POST_UPDATED",
      handle: async (event) => {
        const data = event.data as { postId: string; changes: VersionDiff[] };
        const { postId, changes } = data;

        // Add to sync stream for real-time processing
        await this.redis.xadd(
          "sync:content:changes",
          "*",
          "postId",
          postId,
          "changes",
          JSON.stringify(changes),
          "triggeredBy",
          event.metadata.userId || "system",
          "timestamp",
          new Date().toISOString()
        );
      },
    });
  }

  /**
   * Start scheduled sync processor
   */
  startScheduledSyncProcessor(processScheduledSyncs: () => Promise<void>): void {
    // Process scheduled sync configurations every minute.
    this.scheduler.register(this.scheduledSyncTaskId, processScheduledSyncs, 60000, {
      onError: (err) => log.error({ err }, "Scheduled sync processor error"),
    });
  }

  /**
   * Private methods
   */

  private async startStreamConsumer(): Promise<void> {
    const consumer = async () => {
      try {
        const messages = await this.redis.xreadgroup(
          "GROUP",
          "sync-processors",
          `consumer-${process.pid}`,
          "COUNT",
          10,
          "BLOCK",
          1000,
          "STREAMS",
          "sync:content:changes",
          ">"
        );

        if (messages && messages.length > 0) {
          for (const [_stream, streamMessages] of messages as unknown as Array<
            [string, Array<[string, string[]]>]
          >) {
            for (const [messageId, fields] of streamMessages) {
              await this.processContentChangeMessage(messageId, fields);
              await this.redis.xack("sync:content:changes", "sync-processors", messageId);
            }
          }
        }
      } catch (error: unknown) {
        log.error({ err: error }, "Stream consumer error");
      }

      // Continue consuming
      setImmediate(consumer);
    };

    consumer();
  }

  private async processContentChangeMessage(messageId: string, fields: string[]): Promise<void> {
    try {
      const data = this.parseRedisFields(fields);
      const { postId, changes } = data;

      if (!postId) {
        log.warn({ messageId }, "Missing postId in message");
        return;
      }

      // Execute real-time sync for this content change
      await this.onRealTimeSync(postId, JSON.parse(String(changes)));

      log.info({ postId }, "Processed real-time sync for post");
    } catch (error: unknown) {
      log.error({ err: error, messageId }, "Error processing content change message");
    }
  }

  private parseRedisFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];
      if (key && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }
}
