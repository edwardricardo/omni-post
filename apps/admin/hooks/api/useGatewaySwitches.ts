/**
 * @file useGatewaySwitches.ts
 * @description TanStack Query hooks for gateway switch management: listing events,
 *   fetching detail, and admin actions (extend, force-complete, force-suspend).
 * @layer presentation
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { ApiError, getErrorMessage } from "@/lib/parseApiError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewaySwitchAccount {
  id: string;
  name: string;
  email: string;
}

export interface GatewaySwitchEvent {
  id: string;
  accountId: string;
  fromGateway: "STRIPE" | "PADDLE";
  toGateway: "STRIPE" | "PADDLE";
  requestedAt: string;
  scheduledFor: string;
  completedAt: string | null;
  cancelledAt: string | null;
  reminderSentAt: string | null;
  suspendedAt: string | null;
  extendedUntil: string | null;
  extendedBy: string | null;
  status: "SCHEDULED" | "PENDING_CHECKOUT" | "COMPLETED" | "CANCELLED" | "SUSPENDED" | "EXPIRED";
  metadata: unknown;
  account: GatewaySwitchAccount;
}

export interface GatewaySwitchStats {
  scheduled: number;
  pendingCheckout: number;
  suspended: number;
  completed30d: number;
}

interface GatewaySwitchListResponse {
  ok: boolean;
  data: {
    events: GatewaySwitchEvent[];
    total: number;
    page: number;
    limit: number;
    stats: GatewaySwitchStats;
  };
}

interface GatewaySwitchDetailResponse {
  ok: boolean;
  data: GatewaySwitchEvent;
}

interface ExtendDeadlineResponse {
  ok: boolean;
  data: { newDeadline: string; extendedBy: string };
}

interface GatewaySwitchFilters {
  status?: string;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * @function useGatewaySwitches
 * @description Fetches paginated gateway switch events with optional status filter.
 */
export function useGatewaySwitches(filters: GatewaySwitchFilters = {}) {
  const { status = "ALL", page = 1, limit = 50 } = filters;

  return useQuery({
    queryKey: ["gateway-switches", status, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        status,
        page: String(page),
        limit: String(limit),
      });
      const url = `/api/backend/api/admin/billing/gateway-switches?${params.toString()}`;
      const json = await fetchJson<GatewaySwitchListResponse>(url);
      return json.data;
    },
    staleTime: 60_000,
  });
}

/**
 * @function useGatewaySwitchDetail
 * @description Fetches a single gateway switch event by ID.
 */
export function useGatewaySwitchDetail(id: string | null) {
  return useQuery({
    queryKey: ["gateway-switches", "detail", id],
    queryFn: async () => {
      const json = await fetchJson<GatewaySwitchDetailResponse>(
        `/api/backend/api/admin/billing/gateway-switches/${id}`
      );
      return json.data;
    },
    enabled: id !== null,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * @function useExtendSwitchDeadline
 * @description Extends the checkout deadline for a gateway switch event.
 */
export function useExtendSwitchDeadline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, extraHours }: { id: string; extraHours: number }) => {
      const json = await fetchJson<ExtendDeadlineResponse>(
        `/api/backend/api/admin/billing/gateway-switches/${id}/extend`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extraHours }),
        }
      );
      return json.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-switches"] });
      toast({ title: "Success", description: "Deadline extended successfully" });
    },
    onError: (err) => {
      toast({ title: "Error", description: getErrorMessage(err), variant: "destructive" });
    },
  });
}

/**
 * @function useForceCompleteSwitch
 * @description Forces a gateway switch event to complete.
 */
export function useForceCompleteSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetchJson<{ ok: boolean }>(
        `/api/backend/api/admin/billing/gateway-switches/${id}/force-complete`,
        { method: "POST" }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-switches"] });
      toast({ title: "Success", description: "Switch forced to complete" });
    },
    onError: (err) => {
      toast({ title: "Error", description: getErrorMessage(err), variant: "destructive" });
    },
  });
}

/**
 * @function useForceSuspendSwitch
 * @description Forces a gateway switch event to suspend.
 */
export function useForceSuspendSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await fetchJson<{ ok: boolean }>(
        `/api/backend/api/admin/billing/gateway-switches/${id}/force-suspend`,
        { method: "POST" }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-switches"] });
      toast({ title: "Success", description: "Account suspended" });
    },
    onError: (err) => {
      toast({ title: "Error", description: getErrorMessage(err), variant: "destructive" });
    },
  });
}
