/**
 * @file realtimeWebhookBroadcaster.test-helpers.ts
 * @description Tests for close
 * @layer infrastructure
 */
import { EventEmitter } from "events";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { RealtimeWebhookBroadcaster } from "../../src/webhooks/realtimeWebhookBroadcaster.js";

export class MockWebSocket extends EventEmitter {
  OPEN = 1;
  CLOSED = 3;
  readyState = this.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.emit("close");
  }

  simulateMessage(data: string): void {
    this.emit("message", Buffer.from(data));
  }

  simulateError(error: Error): void {
    this.emit("error", error);
  }

  getLastMessage(): any {
    const last = this.sentMessages[this.sentMessages.length - 1];
    return last ? JSON.parse(last) : null;
  }

  getAllMessages(): any[] {
    return this.sentMessages.map((msg) => JSON.parse(msg));
  }

  clearMessages(): void {
    this.sentMessages = [];
  }
}

export class MockRedis extends EventEmitter {
  publishedMessages: Array<{ channel: string; message: string }> = [];
  subscriptions: Set<string> = new Set();

  async publish(channel: string, message: string): Promise<number> {
    this.publishedMessages.push({ channel, message });
    this.emit("message", channel, message);
    return 1;
  }

  subscribe(channel: string, callback?: (err: Error | null) => void): void {
    this.subscriptions.add(channel);
    if (callback) {
      callback(null);
    }
  }

  duplicate(): MockRedis {
    const dup = new MockRedis();
    this.on("message", (channel, message) => {
      dup.emit("message", channel, message);
    });
    return dup;
  }

  clearPublished(): void {
    this.publishedMessages = [];
  }

  getPublishedCount(channel: string): number {
    return this.publishedMessages.filter((msg) => msg.channel === channel).length;
  }
}

export const state = {
  broadcaster: null as RealtimeWebhookBroadcaster | null,
  mockRedis: null as MockRedis | null,
};

export function setupBroadcaster(): void {
  if (state.broadcaster) {
    state.broadcaster.shutdown();
  }
  state.mockRedis = new MockRedis();
  state.broadcaster = new RealtimeWebhookBroadcaster(
    state.mockRedis as any,
    new NoopBackgroundTaskScheduler()
  );
  state.mockRedis.clearPublished();
}

export function teardownBroadcaster(): void {
  if (state.broadcaster) {
    state.broadcaster.shutdown();
  }
}
