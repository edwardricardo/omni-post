/**
 * @file healthClient.ts
 * @description Health endpoint client. Reports backend liveness via the proxy.
 * @layer infrastructure
 */

import type { HealthResponse } from "../types";
import { request } from "./request";

/**
 * @class HealthClient
 * @description Client for the `/health` endpoint.
 */
export class HealthClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getHealth
   * @description Fetches backend health status.
   * @returns Backend health payload
   */
  async getHealth(): Promise<HealthResponse> {
    return request<HealthResponse>(this.baseUrl, "/health");
  }
}
