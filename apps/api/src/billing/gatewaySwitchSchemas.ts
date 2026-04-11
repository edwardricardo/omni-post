/**
 * @file gatewaySwitchSchemas.ts
 * @description Zod validation schemas for gateway switch endpoints.
 * @layer infrastructure
 */

import { z } from "zod";

export const initiateGatewaySwitchSchema = z.object({
  newProvider: z.enum(["stripe", "paddle"]),
});

export const extendSwitchDeadlineSchema = z.object({
  extraHours: z.number().int().min(1).max(72),
});

export const gatewaySwitchFiltersSchema = z.object({
  status: z
    .enum([
      "SCHEDULED",
      "PENDING_CHECKOUT",
      "COMPLETED",
      "CANCELLED",
      "SUSPENDED",
      "EXPIRED",
      "ALL",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type InitiateGatewaySwitchInput = z.infer<typeof initiateGatewaySwitchSchema>;
export type ExtendSwitchDeadlineInput = z.infer<typeof extendSwitchDeadlineSchema>;
export type GatewaySwitchFiltersInput = z.infer<typeof gatewaySwitchFiltersSchema>;
