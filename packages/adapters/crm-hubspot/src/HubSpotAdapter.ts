/**
 * @file HubSpotAdapter.ts
 * @description HubSpot CRM adapter implementing ICrmAdapter port.
 *   Uses HubSpot v3 API for contacts and Timeline Events for activity logging.
 *   OAuth 2.0 authorization_code flow for authentication.
 * @layer infrastructure
 */

import type { ICrmAdapter, CrmContact, CrmActivityPayload, CrmTokens } from "@ports/core";

export interface HubSpotConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  timelineTemplateId?: string;
}

export class HubSpotAdapter implements ICrmAdapter {
  readonly platform = "HUBSPOT" as const;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly timelineTemplateId: string;
  private readonly baseUrl = "https://api.hubapi.com";

  constructor(config: HubSpotConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
    this.timelineTemplateId = config.timelineTemplateId ?? "";
  }

  /**
   * @method getAuthorizationUrl
   * @description Generates HubSpot OAuth authorization URL.
   */
  getAuthorizationUrl(redirectUri: string, state: string): string {
    const scopes = [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.companies.read",
      "timeline",
    ].join(" ");

    return (
      `https://app.hubspot.com/oauth/authorize?` +
      `client_id=${encodeURIComponent(this.clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri || this.redirectUri)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  /**
   * @method exchangeCodeForTokens
   * @description Exchanges authorization code for access + refresh tokens.
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<CrmTokens> {
    const response = await fetch(`${this.baseUrl}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri || this.redirectUri,
        code,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot token exchange failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  /**
   * @method refreshAccessToken
   * @description Refreshes an expired access token using the refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<CrmTokens> {
    const response = await fetch(`${this.baseUrl}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`HubSpot token refresh failed (${response.status})`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  /**
   * @method fetchContacts
   * @description Fetches contacts from HubSpot v3 API with cursor-based pagination.
   */
  async fetchContacts(
    accessToken: string,
    cursor?: string
  ): Promise<{ contacts: CrmContact[]; nextCursor?: string; hasMore: boolean }> {
    const url = new URL(`${this.baseUrl}/crm/v3/objects/contacts`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("properties", "email,firstname,lastname,company,jobtitle,phone");
    if (cursor) url.searchParams.set("after", cursor);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`HubSpot fetchContacts failed (${response.status})`);
    }

    const data = (await response.json()) as {
      results: Array<{
        id: string;
        properties: Record<string, string>;
      }>;
      paging?: { next?: { after: string } };
    };

    return {
      contacts: data.results.map((r) => ({
        externalId: r.id,
        email: r.properties.email ?? "",
        firstName: r.properties.firstname,
        lastName: r.properties.lastname,
        company: r.properties.company,
        title: r.properties.jobtitle,
        phone: r.properties.phone,
      })),
      nextCursor: data.paging?.next?.after,
      hasMore: !!data.paging?.next,
    };
  }

  /**
   * @method logActivity
   * @description Logs an activity to HubSpot via Timeline Events API.
   */
  async logActivity(
    accessToken: string,
    _instanceUrl: string | undefined,
    payload: CrmActivityPayload
  ): Promise<{ externalId: string }> {
    const body: Record<string, unknown> = {
      eventTemplateId: this.timelineTemplateId,
      timestamp: payload.occurredAt.toISOString(),
      tokens: {
        title: payload.title,
        description: payload.description ?? "",
      },
    };

    if (payload.contactEmail) {
      body.email = payload.contactEmail;
    }

    const response = await fetch(`${this.baseUrl}/crm/v3/timeline/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HubSpot logActivity failed (${response.status})`);
    }

    const data = (await response.json()) as { id: string };
    return { externalId: data.id };
  }
}
