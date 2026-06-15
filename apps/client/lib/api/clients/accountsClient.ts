/**
 * @file accountsClient.ts
 * @description Accounts domain client. Handles account-scoped project listing
 *              for the multi-tenant partition model — each Account owns N
 *              Projects, each Project owns its own channels/posts/connections.
 *              Used by `ProjectProvider` to resolve the active project after
 *              authentication.
 * @layer infrastructure
 */

import type { Project } from "../types.js";
import { request } from "./request.js";

/**
 * @class AccountsClient
 * @description Client for `/accounts/:accountId/*` endpoints.
 */
export class AccountsClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getAccountProjects
   * @description Lists projects belonging to the given account. Backend
   *              returns projects ordered by `createdAt DESC` per
   *              `apps/api/src/projects/projectRoutes.ts:listProjects`.
   * @param accountId - The account whose projects to fetch
   * @returns Array of Project records (empty array if account has none)
   */
  async getAccountProjects(accountId: string): Promise<Project[]> {
    const data = await request<{ ok: boolean; value?: Project[] }>(
      this.baseUrl,
      `/accounts/${accountId}/projects`
    );
    return data.ok && Array.isArray(data.value) ? data.value : [];
  }
}
