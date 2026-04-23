/**
 * @file CrmAdapter.ts
 * @description Port interface for CRM platform adapters (HubSpot, Salesforce).
 *              Technology-free contract for OAuth, contact sync, and activity logging.
 * @layer domain
 */

/**
 * CRM contact as returned by a provider adapter.
 */
export interface CrmContact {
  readonly externalId: string;
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly company?: string;
  readonly title?: string;
  readonly phone?: string;
}

/**
 * Payload for logging an activity to the CRM.
 */
export interface CrmActivityPayload {
  readonly type: string;
  readonly title: string;
  readonly description?: string;
  readonly occurredAt: Date;
  readonly contactEmail?: string;
  readonly postId?: string;
  readonly campaignId?: string;
}

/**
 * OAuth tokens returned by the CRM provider.
 */
export interface CrmTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: Date;
  readonly portalId?: string;
  readonly instanceUrl?: string;
}

/**
 * Paginated result for contact fetching.
 */
export interface CrmContactPage {
  readonly contacts: readonly CrmContact[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

/**
 * Technology-free interface for CRM platform adapters.
 */
export interface ICrmAdapter {
  /**
   * Returns the OAuth authorization URL for the CRM platform.
   */
  getAuthorizationUrl(redirectUri: string, state: string): string;

  /**
   * Exchanges an OAuth authorization code for access/refresh tokens.
   */
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<CrmTokens>;

  /**
   * Refreshes an expired access token using the refresh token.
   */
  refreshAccessToken(refreshToken: string): Promise<CrmTokens>;

  /**
   * Fetches contacts from the CRM, paginated via cursor.
   */
  fetchContacts(accessToken: string, cursor?: string): Promise<CrmContactPage>;

  /**
   * Logs an activity/engagement to the CRM.
   */
  logActivity(accessToken: string, payload: CrmActivityPayload): Promise<string | null>;
}
