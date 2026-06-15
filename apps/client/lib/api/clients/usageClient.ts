/**
 * @file usageClient.ts
 * @description Usage-domain transport helper. Fetches the account usage
 *              + plan-context payload from
 *              `GET /accounts/:accountId/usage?year=YYYY&month=M` (backed
 *              by `GetUsageUseCase`'s 3-leg JOIN). Uses the canonical
 *              `request<T>` helper which routes through the Next.js proxy
 *              and throws `ApiError` on non-OK responses.
 * @layer infrastructure
 */

import { request, PROXY_BASE } from "./request.js";
import type { ApiResponse } from "../types.js";

/**
 * Account usage + plan context DTO. Mirrors the backend `UsageDto` from
 * `apps/api/src/application/usage/GetUsageUseCase.ts`.
 *
 * `postsLimit` / `channelsLimit` are nullable — the page renders
 * "Unlimited" when null (enterprise tier or no subscription bundle).
 */
export interface AccountUsageDto {
  accountId: string;
  periodYear: number;
  periodMonth: number;

  // Counters (this period)
  postsPublished: number;
  aiCallsMade: number;
  storageGb: number;
  teamMemberCount: number;

  // Plan context (joined from Account + AccountSubscription + Bundle)
  plan: string;
  channelsCount: number;
  postsLimit: number | null;
  channelsLimit: number | null;
  teamMembersLimit: number;
  storageLimitGb: number;
  isOnTrial: boolean;
  trialEndDate: string | null;
  nextBillingDate: string | null;
}

/**
 * @function fetchAccountUsage
 * @description Loads the current-period usage + plan context for an account.
 *              Server interprets year/month as UTC; this client computes
 *              the period from the browser's UTC clock.
 *              Throws `ApiError` on non-OK responses (surfaced via
 *              TanStack `error`).
 * @param accountId - Account identifier (UUID).
 * @returns AccountUsageDto for the current calendar month.
 */
export async function fetchAccountUsage(accountId: string): Promise<AccountUsageDto> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const url = `/accounts/${encodeURIComponent(accountId)}/usage?year=${year}&month=${month}`;

  const envelope = await request<ApiResponse<AccountUsageDto>>(PROXY_BASE, url, {
    cache: "no-store",
  });

  if (!envelope.ok || !envelope.data) {
    throw new Error(envelope.error ?? envelope.message ?? "Failed to fetch usage data");
  }

  return envelope.data;
}
