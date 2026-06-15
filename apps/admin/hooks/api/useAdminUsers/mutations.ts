/**
 * @file mutations.ts
 * @description Mutation hooks for admin users — create, activate, deactivate,
 *              update profile.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { activateAdminUser, createAdminUser, deactivateAdminUser, updateAdminUser } from "./api.js";

const ADMIN_USERS_KEY = ["admin", "users"] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
}

/**
 * @hook useCreateAdminUser
 * @description Mutation that creates a new admin user. Returns the created user and a temporary password.
 * @returns Mutation object with mutate({ email, name, role }) and status fields
 */
export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useDeactivateAdminUser
 * @description Mutation that deactivates an admin user by ID.
 * @returns Mutation object with mutate(userId) and status fields
 */
export function useDeactivateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deactivateAdminUser,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useActivateAdminUser
 * @description Mutation that activates a previously deactivated admin user by ID.
 * @returns Mutation object with mutate(userId) and status fields
 */
export function useActivateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: activateAdminUser,
    onSuccess: () => invalidate(qc),
  });
}

/**
 * @hook useUpdateAdminUser
 * @description Mutation that updates an admin user's profile data (name, email, department, team).
 * @returns Mutation object with mutate({ id, data }) and status fields
 */
export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateAdminUser,
    onSuccess: () => invalidate(qc),
  });
}
