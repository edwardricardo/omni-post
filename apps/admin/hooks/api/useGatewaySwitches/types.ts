/**
 * @file types.ts
 * @description Public types for the gateway-switches admin hook module.
 * @layer infrastructure
 */

type GatewayName = "STRIPE" | "PADDLE";

type GatewaySwitchStatus =
  "SCHEDULED" | "PENDING_CHECKOUT" | "COMPLETED" | "CANCELLED" | "SUSPENDED" | "EXPIRED";

interface GatewaySwitchAccount {
  id: string;
  name: string;
  email: string;
}

export interface GatewaySwitchEvent {
  id: string;
  accountId: string;
  fromGateway: GatewayName;
  toGateway: GatewayName;
  requestedAt: string;
  scheduledFor: string;
  completedAt: string | null;
  cancelledAt: string | null;
  reminderSentAt: string | null;
  suspendedAt: string | null;
  extendedUntil: string | null;
  extendedBy: string | null;
  status: GatewaySwitchStatus;
  metadata: unknown;
  account: GatewaySwitchAccount;
}

interface GatewaySwitchStats {
  scheduled: number;
  pendingCheckout: number;
  suspended: number;
  completed30d: number;
}

export interface GatewaySwitchListData {
  events: GatewaySwitchEvent[];
  total: number;
  page: number;
  limit: number;
  stats: GatewaySwitchStats;
}

export interface GatewaySwitchListResponse {
  ok: boolean;
  data: GatewaySwitchListData;
}

export interface GatewaySwitchDetailResponse {
  ok: boolean;
  data: GatewaySwitchEvent;
}

export interface ExtendDeadlineResponse {
  ok: boolean;
  data: { newDeadline: string; extendedBy: string };
}

export interface GatewaySwitchFilters {
  status?: string;
  page?: number;
  limit?: number;
}
