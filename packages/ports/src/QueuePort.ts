import type { Result } from "@shared/types";

export type QueueJob = {
  id?: string;
  dedupeKey: string;
  runAt?: Date;
  payload: Record<string, unknown>;
};

export type QueueHealth = {
  connected: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
};

export interface QueuePort {
  enqueue(job: QueueJob): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">>;
  health(): Promise<Result<QueueHealth, "CONNECTION_ERROR">>;
  remove(jobId: string): Promise<Result<boolean, "CONNECTION_ERROR" | "NOT_FOUND">>;
}
