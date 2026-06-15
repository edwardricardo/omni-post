/**
 * @file providersClient.ts
 * @description Providers domain client. Lists providers, fetches provider
 *              metadata, and reads provider health status.
 * @layer infrastructure
 */

import type { Provider, ProviderHealth } from "../types.js";
import { request } from "./request.js";

export interface ProvidersListResponse {
  ok: boolean;
  providers: Provider[];
  total: number;
}

export interface ProviderEnvelope {
  ok: boolean;
  provider: Provider;
}

export interface ProviderHealthEnvelope {
  ok: boolean;
  health: ProviderHealth;
}

export interface ProvidersHealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  avgLatency: number;
}

export interface ProvidersHealthResponse {
  ok: boolean;
  providers: ProviderHealth[];
  summary: ProvidersHealthSummary;
}

/**
 * @class ProvidersClient
 * @description Client for `/providers` endpoints.
 */
export class ProvidersClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method getProviders
   * @description Lists all configured providers.
   */
  async getProviders(): Promise<ProvidersListResponse> {
    return request<ProvidersListResponse>(this.baseUrl, "/providers");
  }

  /**
   * @method getActiveProviders
   * @description Lists only providers currently active for the user.
   */
  async getActiveProviders(): Promise<ProvidersListResponse> {
    return request<ProvidersListResponse>(this.baseUrl, "/providers/active");
  }

  /**
   * @method getProviderById
   * @description Fetches a provider by ID.
   * @param id - Provider identifier
   */
  async getProviderById(id: string): Promise<ProviderEnvelope> {
    return request<ProviderEnvelope>(this.baseUrl, `/providers/${id}`);
  }

  /**
   * @method getProviderHealth
   * @description Reads health status for a single provider.
   * @param id - Provider identifier
   */
  async getProviderHealth(id: string): Promise<ProviderHealthEnvelope> {
    return request<ProviderHealthEnvelope>(this.baseUrl, `/providers/${id}/health`);
  }

  /**
   * @method getAllProvidersHealth
   * @description Reads aggregated health status across all providers.
   */
  async getAllProvidersHealth(): Promise<ProvidersHealthResponse> {
    return request<ProvidersHealthResponse>(this.baseUrl, "/providers/health");
  }
}
