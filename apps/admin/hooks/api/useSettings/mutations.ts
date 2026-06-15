/**
 * @file mutations.ts
 * @description Mutation hooks for platform settings — update group
 *              credentials, delete a single credential, test connection
 *              (no cache effect), rotate encryption key.
 * @layer infrastructure
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteCredential, rotateEncryption, testConnection, updateGroupSettings } from "./api.js";

const SETTINGS_KEY = ["settings"] as const;

/**
 * @hook useUpdateGroupSettings
 * @description Mutation that saves credentials for a group.
 *   Only sends modified fields. Invalidates settings queries on success.
 * @returns Mutation object with mutate({ group, credentials }) and status fields
 */
export function useUpdateGroupSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateGroupSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

/**
 * @hook useDeleteCredential
 * @description Mutation that deletes a single credential key from a group.
 *   Invalidates settings queries on success.
 * @returns Mutation object with mutate({ group, key }) and status fields
 */
export function useDeleteCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCredential,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

/**
 * @hook useTestConnection
 * @description Mutation that tests connectivity for a credential group.
 *   Does not invalidate queries since this is a read-only operation.
 * @returns Mutation object with mutate(group) and { data: TestResult }
 */
export function useTestConnection() {
  return useMutation({
    mutationFn: testConnection,
  });
}

/**
 * @hook useRotateEncryption
 * @description Mutation that logs an encryption key rotation event.
 *   Invalidates settings queries on success.
 * @returns Mutation object with mutate({ note? }) and status fields
 */
export function useRotateEncryption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rotateEncryption,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}
