/**
 * @file api.ts
 * @description Internal fetch helpers for the platform settings endpoints.
 *              Errors flow through `ApiError.fromResponse`.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";
import type { GroupCredentials, SettingsStatus, TestResult } from "./types";

const BASE = "/api/backend/admin/settings";

async function settingsFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: T };
  if (!json.ok || !json.data) {
    throw new Error("Unexpected response format");
  }
  return json.data;
}

export function fetchSettingsStatus(): Promise<SettingsStatus> {
  return settingsFetch<SettingsStatus>(`${BASE}/status`);
}

export function fetchGroupSettings(group: string): Promise<GroupCredentials> {
  return settingsFetch<GroupCredentials>(`${BASE}/${group}`);
}

export async function updateGroupSettings(input: {
  group: string;
  credentials: Record<string, string>;
}): Promise<void> {
  const res = await fetch(`${BASE}/${input.group}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credentials: input.credentials }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
}

export async function deleteCredential(input: { group: string; key: string }): Promise<void> {
  const res = await fetch(`${BASE}/${input.group}/${input.key}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
}

export function testConnection(group: string): Promise<TestResult> {
  return settingsFetch<TestResult>(`${BASE}/${group}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function rotateEncryption(note?: string): Promise<{ message: string }> {
  return settingsFetch<{ message: string }>(`${BASE}/encryption/rotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note !== undefined ? { note } : {}),
  });
}
