/**
 * @file api.ts
 * @description Internal fetch helpers for the gateway-switches admin endpoints.
 *              Errors flow through `ApiError.fromResponse` so callers can show
 *              structured admin messages.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";
import type {
  ExtendDeadlineResponse,
  GatewaySwitchDetailResponse,
  GatewaySwitchEvent,
  GatewaySwitchListData,
  GatewaySwitchListResponse,
} from "./types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json() as Promise<T>;
}

export async function fetchGatewaySwitches(params: {
  status: string;
  page: number;
  limit: number;
}): Promise<GatewaySwitchListData> {
  const search = new URLSearchParams({
    status: params.status,
    page: String(params.page),
    limit: String(params.limit),
  });
  const url = `/api/backend/admin/billing/gateway-switches?${search.toString()}`;
  const json = await fetchJson<GatewaySwitchListResponse>(url);
  return json.data;
}

export async function fetchGatewaySwitchDetail(id: string): Promise<GatewaySwitchEvent> {
  const json = await fetchJson<GatewaySwitchDetailResponse>(
    `/api/backend/admin/billing/gateway-switches/${id}`
  );
  return json.data;
}

export async function extendSwitchDeadline(input: {
  id: string;
  extraHours: number;
}): Promise<ExtendDeadlineResponse["data"]> {
  const json = await fetchJson<ExtendDeadlineResponse>(
    `/api/backend/admin/billing/gateway-switches/${input.id}/extend`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraHours: input.extraHours }),
    }
  );
  return json.data;
}

export async function forceCompleteSwitch(id: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(
    `/api/backend/admin/billing/gateway-switches/${id}/force-complete`,
    { method: "POST" }
  );
}

export async function forceSuspendSwitch(id: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(
    `/api/backend/admin/billing/gateway-switches/${id}/force-suspend`,
    { method: "POST" }
  );
}
