/**
 * @file useBulkScheduling.ts
 * @description TanStack Query mutation hooks for the 2-phase bulk-scheduling
 *              flow: `useBulkScheduleParse` (POST /bulk-scheduling/parse) and
 *              `useBulkScheduleConfirm` (POST /bulk-scheduling/confirm).
 *              The legacy `/bulk-scheduling/imports` endpoint is NOT called here —
 *              it is retired (410 Gone) and replaced by these two hooks.
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import type {
  SchedulingCsvRow,
  ParseSchedulingCsvResult,
} from "../../lib/csv/bulkSchedulingCsvParser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for the parse phase. */
export interface BulkScheduleParseInput {
  projectId: string;
  /** Raw CSV text to send to the server for structural validation. */
  csv: string;
}

/** Input for the confirm phase. */
export interface BulkScheduleConfirmInput {
  projectId: string;
  /** Channel IDs selected by the user. At least one is required by the backend. */
  channelIds: string[];
  /** Validated rows from the parse phase. */
  rows: SchedulingCsvRow[];
}

/** Response from the confirm phase. */
export interface BulkScheduleConfirmResult {
  batchId: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const PROXY = "/api/backend";

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body?.error ?? body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function callParse(input: BulkScheduleParseInput): Promise<ParseSchedulingCsvResult> {
  const res = await fetch(`${PROXY}/bulk-scheduling/parse`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: input.projectId, csv: input.csv }),
  });

  if (!res.ok) {
    const message = await readApiError(res, `Parse failed (HTTP ${res.status})`);
    throw new Error(`${res.status}: ${message}`);
  }

  const body = (await res.json()) as {
    ok: boolean;
    data?: ParseSchedulingCsvResult;
    error?: string;
  };
  if (!body.ok || !body.data) {
    throw new Error(body.error ?? "Parse API error");
  }
  return body.data;
}

async function callConfirm(input: BulkScheduleConfirmInput): Promise<BulkScheduleConfirmResult> {
  const res = await fetch(`${PROXY}/bulk-scheduling/confirm`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      channelIds: input.channelIds,
      rows: input.rows,
    }),
  });

  if (!res.ok) {
    const message = await readApiError(res, `Confirm failed (HTTP ${res.status})`);
    throw new Error(`${res.status}: ${message}`);
  }

  const body = (await res.json()) as {
    ok: boolean;
    data?: BulkScheduleConfirmResult;
    error?: string;
  };
  if (!body.ok || !body.data) {
    throw new Error(body.error ?? "Confirm API error");
  }
  return body.data;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useBulkScheduleParse
 * @description Mutation hook for the parse step of the bulk-scheduling flow.
 *   POSTs the raw CSV to `/bulk-scheduling/parse` for server-side structural
 *   validation. Does NOT write any data to the database.
 * @returns TanStack mutation with `{ validRows, errors, totalDataRows }` on success.
 */
export function useBulkScheduleParse() {
  return useMutation({
    mutationFn: callParse,
  });
}

/**
 * @hook useBulkScheduleConfirm
 * @description Mutation hook for the confirm step of the bulk-scheduling flow.
 *   POSTs validated rows + selected channel IDs to `/bulk-scheduling/confirm`.
 *   The server persists the batch atomically (one UoW transaction). Throws on
 *   403 (foreign channelId), 500, or any non-ok response.
 * @returns TanStack mutation with `{ batchId }` on success.
 */
export function useBulkScheduleConfirm() {
  return useMutation({
    mutationFn: callConfirm,
  });
}
